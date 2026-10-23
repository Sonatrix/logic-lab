'use strict';
// Circuit state, simulation engine, block library, import/export. No DOM access.

const GRID = 10;
const STORE_KEY = 'logic-lab-v2';
const BLOCKS_KEY = 'logic-lab-blocks';

const fresh = () => ({ nodes: [], wires: [], nextId: 1, counters: { INPUT: 0, OUTPUT: 0 } });
const newSim = () => ({ outs: {}, mem: {} });
let state = fresh();
let sim = newSim();          // outs: "nodeId:outPort" -> boolean (kept so latches hold state); mem: per-node memory
let stable = true;

const byId = id => state.nodes.find(n => n.id === id);
const snap = v => Math.round(v / GRID) * GRID;
const val = (id, p = 0) => !!sim.outs[id + ':' + p];
const portPos = (n, kind, idx) => {
  const g = geom(n);
  return kind === 'out' ? { x: n.x + g.outs[idx][0], y: n.y + g.outs[idx][1] } : { x: n.x, y: n.y + g.ins[idx] };
};

function combos(n) {
  return Array.from({ length: 1 << n }, (_, r) => Array.from({ length: n }, (_, i) => !!((r >> (n - 1 - i)) & 1)));
}

// ---------------------------------------------------------------- simulation
// One sweep over the nodes. Combinational parts update in order and see fresh values (Gauss-Seidel);
// clocked chips, and every part when `sync` is set, read the values from the start of the sweep. That
// gives flip-flops proper "everyone samples the old values" behaviour (shift registers, counters).
// With `sync` (slow-mo / step modes) gates may carry a propagation delay: a gate with delay d shows its
// result d sweeps late (a transport delay, so short glitches survive). Instant mode ignores delays.
function pass(nodes, wires, s, sync, touched) {
  const src = {};
  for (const w of wires) src[w.to + ':' + w.port] = w.from + ':' + (w.fp || 0);
  const snapshot = { ...s.outs };
  let changed = false, busy = false;
  for (const n of nodes) {
    const from = (sync || (CHIPS[n.type] && CHIPS[n.type].clocked)) ? snapshot : s.outs;
    const read = i => !!from[src[n.id + ':' + i]];
    let result = compute(n, read, s);
    if (n.delay > 1 && isGate(n.type)) {
      const m = s.mem[n.id] || (s.mem[n.id] = {});
      if (!sync) delete m.pipe;
      else {
        if (!m.pipe || m.pipe.length !== n.delay - 1) m.pipe = Array(n.delay - 1).fill(!!s.outs[n.id + ':0']);
        m.pipe.push(result[0]);
        result = [m.pipe.shift()];
        if (m.pipe.some(v => v !== result[0])) busy = true;     // a value is still travelling through the gate
      }
    }
    for (let k = 0; k < result.length; k++) {
      const key = n.id + ':' + k;
      if (s.outs[key] !== result[k]) { s.outs[key] = result[k]; changed = true; if (touched) touched.add(n.id); }
    }
  }
  return changed || busy;
}

function compute(n, read, s) {
  switch (n.type) {
    case 'INPUT': case 'CLOCK': case 'BUTTON': return [!!n.value];
    case 'HIGH': return [true];
    case 'LOW': return [false];
    case 'OUTPUT': return [read(0)];
    case 'SEG7': case 'BUSOUT': case 'NOTE': return [];
    case 'BUSIN': return numToBits(n.num || 0, n.bits === 8 ? 8 : 4);
    case 'BLOCK': return runBlock(n, geom(n).ins.map((_, i) => read(i)), s);
  }
  const ins = geom(n).ins.map((_, i) => read(i));
  const chip = CHIPS[n.type];
  if (chip) return chip.eval(ins, s.mem[n.id] || (s.mem[n.id] = {})).map(Boolean);
  return [!!GATES[n.type].fn(ins)];
}

// A block runs its own private copy of the inner circuit to stability each time it is evaluated.
function runBlock(n, ins, s) {
  const d = BLOCKS.get(n.block);
  if (!d) return [];
  const m = s.mem[n.id] || (s.mem[n.id] = {});
  if (!m.nodes) { m.nodes = d.nodes.map(x => ({ ...x })); m.outs = {}; m.mem = {}; }
  d.ins.forEach((id, i) => { m.nodes.find(x => x.id === id).value = ins[i]; });
  settle(m.nodes, d.wires, m);
  return d.outs.map(id => !!m.outs[id + ':0']);
}

// Repeat until nothing changes. Feedback circuits such as latches settle; true oscillators hit the cap.
function settle(nodes, wires, s, max = 100) {
  for (let i = 0; i < max; i++) if (!pass(nodes, wires, s, false)) return true;
  return false;
}
const evalAll = () => { stable = settle(state.nodes, state.wires, sim); };

// Run `rowFn(bits)` for every combination of the given INPUT nodes, then restore the live state.
function sweep(ins, rowFn) {
  const saved = { sim: structuredClone(sim), vals: ins.map(n => n.value), stable };
  const rows = combos(ins.length).map(c => { ins.forEach((n, i) => { n.value = c[i]; }); evalAll(); return rowFn(c); });
  ins.forEach((n, i) => { n.value = saved.vals[i]; });
  sim = saved.sim; stable = saved.stable;
  return rows;
}

// ---------------------------------------------------------------- specs (examples, lessons)
// spec: { nodes: [[key, type, x, y, label?, opts?]], wires: [[from, to, toPort, fromPort = 0]] }
// Returns a fresh circuit state; the live `state` is left untouched. Coordinates are the top-left corner.
function specToState(spec) {
  const keep = state;
  state = fresh();
  try {
    const ids = {};
    for (const [key, type, x, y, label, opts] of spec.nodes) {
      const g = geom({ type, label, ...opts });
      ids[key] = addNode(type, x + g.w / 2, y + g.h / 2, label, opts).id;
    }
    for (const [f, t, p, fp = 0] of spec.wires) connect(ids[f], fp, ids[t], p);
    state.counters = { INPUT: state.nodes.filter(n => n.type === 'INPUT').length, OUTPUT: state.nodes.filter(n => n.type === 'OUTPUT').length };
    return state;
  } finally { state = keep; }
}

// Run `fn` with another circuit temporarily installed as the live state (fresh simulation).
function withCircuit(circuit, fn) {
  const keepState = state, keepSim = sim, keepStable = stable;
  state = circuit; sim = newSim();
  try { return fn(); } finally { state = keepState; sim = keepSim; stable = keepStable; }
}

// ---------------------------------------------------------------- mutations
function addNode(type, cx, cy, label, extra) {
  const n = { id: state.nextId++, type, x: 0, y: 0 };
  if (extra) Object.assign(n, extra);
  if (type === 'INPUT') { n.label = label || String.fromCharCode(65 + (state.counters.INPUT++ % 26)); n.value = !!n.value; }
  else if (type === 'BUTTON') { n.label = label || 'BTN'; n.value = false; }
  else if (type === 'CLOCK') { n.label = 'CLK'; n.value = false; n.hz = n.hz || 1; }
  else if (type === 'OUTPUT') { n.label = label || 'Y' + (++state.counters.OUTPUT); }
  else if (type === 'BUSIN') { n.bits = n.bits === 8 ? 8 : 4; n.num = (n.num || 0) & ((1 << n.bits) - 1); }
  else if (type === 'BUSOUT') n.bits = n.bits === 8 ? 8 : 4;
  else if (type === 'NOTE') n.text = String(n.text || 'Note').slice(0, 80);
  const g = geom(n);                                             // after the label: switch width depends on it
  n.x = snap(cx - g.w / 2); n.y = snap(cy - g.h / 2);
  state.nodes.push(n);
  return n;
}

function removeNodes(ids) {
  const gone = new Set(ids);
  state.nodes = state.nodes.filter(n => !gone.has(n.id));
  state.wires = state.wires.filter(w => !gone.has(w.from) && !gone.has(w.to));
  for (const id of gone) {
    for (const k of Object.keys(sim.outs)) if (k.startsWith(id + ':')) delete sim.outs[k];
    delete sim.mem[id];
  }
}

function connect(from, fp, to, port) {
  state.wires = state.wires.filter(w => !(w.to === to && w.port === port)); // one driver per input
  state.wires.push({ from, fp, to, port });
}

// ---------------------------------------------------------------- block library
const BLOCK_NAME_RE = /^[\w ()+·*-]{1,16}$/;

function makeDef(nodes, wires) {
  const pins = t => nodes.filter(n => n.type === t).sort((a, b) => a.y - b.y || a.x - b.x);
  const ins = pins('INPUT'), outs = pins('OUTPUT');
  return { nodes, wires, ins: ins.map(n => n.id), outs: outs.map(n => n.id), insLabels: ins.map(n => n.label), outsLabels: outs.map(n => n.label) };
}

function saveBlock(name, ids) {
  name = String(name || '').trim();
  if (!BLOCK_NAME_RE.test(name)) return { error: 'Block names are 1–16 letters, digits or spaces.' };
  if (BLOCKS.has(name)) return { error: `A block named "${name}" already exists.` };
  const set = new Set(ids);
  const nodes = state.nodes.filter(n => set.has(n.id)).map(n => JSON.parse(JSON.stringify(n)));
  if (nodes.some(n => n.type === 'CLOCK' || n.type === 'BUTTON')) return { error: 'Blocks cannot contain a Clock or Button. Use a Switch as the block input instead.' };
  nodes.forEach(n => { if (n.type === 'INPUT') n.value = false; });
  const wires = state.wires.filter(w => set.has(w.from) && set.has(w.to)).map(w => ({ ...w }));
  const def = makeDef(nodes, wires);
  if (!def.ins.length || !def.outs.length) return { error: 'Select at least one Switch (block input) and one LED (block output) along with the gates between them.' };
  BLOCKS.set(name, def);
  persistBlocks();
  return { ok: true };
}

function deleteBlock(name) {
  const used = n => n.type === 'BLOCK' && n.block === name;
  if (state.nodes.some(used) || [...BLOCKS.values()].some(d => d.nodes.some(used))) return { error: `"${name}" is in use. Remove it from the circuit and from other blocks first.` };
  BLOCKS.delete(name);
  persistBlocks();
  return { ok: true };
}

function persistBlocks() {
  try { localStorage.setItem(BLOCKS_KEY, JSON.stringify([...BLOCKS].map(([name, d]) => ({ name, nodes: d.nodes, wires: d.wires })))); } catch { /* storage unavailable */ }
}

function loadBlocks() {
  try {
    for (const b of JSON.parse(localStorage.getItem(BLOCKS_KEY)) || []) {
      const c = sanitizeCircuit({ nodes: b.nodes, wires: b.wires });
      if (c && BLOCK_NAME_RE.test(b.name)) BLOCKS.set(b.name, makeDef(c.nodes, c.wires));
    }
  } catch { /* ignore corrupt data */ }
}

// ---------------------------------------------------------------- validation (untrusted input)
// Rebuilds a circuit keeping only known fields; returns null if anything is invalid.
function sanitizeCircuit(raw) {
  if (!raw || !Array.isArray(raw.nodes) || !Array.isArray(raw.wires) || raw.nodes.length > 1000 || raw.wires.length > 4000) return null;
  const nodes = [], ids = new Map();
  for (const n of raw.nodes) {
    if (!n || !PARTS.has(n.type) || ![n.id, n.x, n.y].every(v => Number.isFinite(+v)) || ids.has(Math.floor(+n.id))) return null;
    const c = { id: Math.floor(+n.id), type: n.type, x: +n.x, y: +n.y };
    if (['INPUT', 'CLOCK', 'BUTTON', 'OUTPUT'].includes(n.type)) c.label = String(n.label ?? '').slice(0, 6) || '?';
    if (n.type === 'INPUT' || n.type === 'CLOCK') c.value = !!n.value;
    if (n.type === 'BUTTON') c.value = false;
    if (n.type === 'CLOCK') c.hz = CLOCK_RATES.includes(+n.hz) ? +n.hz : 1;
    if (n.type === 'BLOCK') { if (typeof n.block !== 'string' || !BLOCKS.has(n.block)) return null; c.block = n.block; }
    if (n.type === 'BUSIN' || n.type === 'BUSOUT') c.bits = BUS_WIDTHS.includes(+n.bits) ? +n.bits : 4;
    if (n.type === 'BUSIN') c.num = Math.max(0, Math.floor(+n.num || 0)) & ((1 << c.bits) - 1);
    if (n.type === 'NOTE') c.text = String(n.text ?? '').slice(0, 80) || 'Note';
    if (isGate(n.type) && +n.delay > 1) c.delay = Math.min(MAX_DELAY, Math.floor(+n.delay));
    if (isGate(n.type) && GATES[n.type].multi && n.n) c.n = Math.min(MAX_INPUTS, Math.max(2, Math.floor(+n.n) || 2));
    ids.set(c.id, c); nodes.push(c);
  }
  const wires = [];
  for (const w of raw.wires) {
    if (!w || typeof w !== 'object') return null;
    const from = ids.get(Math.floor(+w.from)), to = ids.get(Math.floor(+w.to)), fp = Math.floor(+w.fp || 0), port = Math.floor(+w.port);
    if (!from || !to || fp < 0 || fp >= geom(from).outs.length || !(port >= 0 && port < geom(to).ins.length)) return null;
    const c = { from: from.id, fp, to: to.id, port };
    if (typeof w.name === 'string' && w.name.trim()) c.name = w.name.trim().slice(0, 12);
    wires.push(c);
  }
  const count = t => nodes.filter(n => n.type === t).length;
  return {
    nodes, wires,
    nextId: Math.max(0, ...nodes.map(n => n.id)) + 1,
    counters: { INPUT: Math.max(+raw.counters?.INPUT || 0, count('INPUT')), OUTPUT: Math.max(+raw.counters?.OUTPUT || 0, count('OUTPUT')) },
  };
}

// ---------------------------------------------------------------- export / import / share payload
function collectBlocks(nodes, out = [], seen = new Set()) {
  for (const n of nodes) {
    if (n.type !== 'BLOCK' || seen.has(n.block)) continue;
    seen.add(n.block);
    const d = BLOCKS.get(n.block);
    if (d) { collectBlocks(d.nodes, out, seen); out.push({ name: n.block, nodes: d.nodes, wires: d.wires }); }  // dependencies first
  }
  return out;
}

// Bump when the saved format changes incompatibly. Older files (no version, or 2) still load.
const SCHEMA_VERSION = 3;
let importError = '';            // human-readable reason for the last rejected import

const exportPayload = view => ({ version: SCHEMA_VERSION, ...state, view, blocks: collectBlocks(state.nodes) });

// Validates an untrusted payload and merges any bundled blocks into the library.
// Returns the sanitized circuit, or null (and leaves the library untouched) when invalid.
function importPayload(raw) {
  importError = '';
  if (!raw || typeof raw !== 'object') return null;
  if (+raw.version > SCHEMA_VERSION) { importError = 'This circuit was made with a newer version of Logic Lab. Please update the app.'; return null; }
  const rename = new Map(), added = [];
  const remap = nodes => Array.isArray(nodes) ? nodes.map(n => (n && n.type === 'BLOCK' && rename.has(n.block)) ? { ...n, block: rename.get(n.block) } : n) : nodes;
  const rollback = () => { added.forEach(name => BLOCKS.delete(name)); return null; };

  for (const b of (Array.isArray(raw.blocks) ? raw.blocks.slice(0, 50) : [])) {
    const name = String(b?.name ?? '');
    const c = BLOCK_NAME_RE.test(name) && sanitizeCircuit({ nodes: remap(b.nodes), wires: b.wires });
    if (!c) return rollback();
    const def = makeDef(c.nodes, c.wires), old = BLOCKS.get(name);
    if (old && JSON.stringify([old.nodes, old.wires]) === JSON.stringify([def.nodes, def.wires])) continue;   // already have it
    let finalName = name;
    while (BLOCKS.has(finalName)) finalName += '*';
    if (finalName !== name) rename.set(name, finalName);
    BLOCKS.set(finalName, def); added.push(finalName);
  }
  const circuit = sanitizeCircuit({ ...raw, nodes: remap(raw.nodes) });
  if (!circuit) return rollback();
  if (added.length) persistBlocks();
  return circuit;
}
