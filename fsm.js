'use strict';
// Finite-state-machine designer: a transition table becomes D flip-flops plus minimized logic. No DOM access.
//
//   inputs: X
//   outputs: Z
//   S0 0 -> S0 / 0      STATE  input-bits  ->  NEXT  /  output-bits   (Mealy outputs; x or * = don't care)
//   S0 1 -> S1 / 0
//
// The first state listed is the reset state (all flip-flops start at 0). Transitions you leave out stay in the
// same state with all outputs 0. Unused state codes are treated as don't-cares to simplify the logic.

const FSM_EXAMPLES = {
  'Detect two 1s in a row': `# Mealy machine: Z = 1 while the input is 1 and the previous input was also 1
inputs: X
outputs: Z
S0 0 -> S0 / 0
S0 1 -> S1 / 0
S1 0 -> S0 / 0
S1 1 -> S1 / 1`,
  'Traffic light (3 states)': `# No inputs: just cycle green -> yellow -> red. The output bits are R, Y, G while in that state.
outputs: R, Y, G
GREEN -> YELLOW / 001
YELLOW -> RED / 010
RED -> GREEN / 100`,
  'Two-bit up counter with enable': `# Counts 0,1,2,3 while EN=1, holds while EN=0
inputs: EN
outputs: Q1x, Q0x
C0 0 -> C0 / 00
C0 1 -> C1 / 00
C1 0 -> C1 / 01
C1 1 -> C2 / 01
C2 0 -> C2 / 10
C2 1 -> C3 / 10
C3 0 -> C3 / 11
C3 1 -> C0 / 11`,
};

const FSM_LIMITS = { states: 8, inputs: 3, outputs: 4 };
const FSM_NAME = /^[A-Za-z_]\w{0,5}$/;

function parseFsm(text) {
  const raw = text.split('\n').map((l, i) => ({ s: l.replace(/(#|\/\/).*$/, '').trim(), line: i + 1 })).filter(l => l.s);
  const list = (s, line, what) => {
    const items = s.split(/[,\s]+/).filter(Boolean);
    for (const it of items) if (!FSM_NAME.test(it)) throw new Error(`Line ${line}: "${it}" is not a valid ${what} name (1–6 letters/digits)`);
    return items;
  };
  let inputs = [], outputs = [];
  for (const { s, line } of raw) {
    let m;
    if ((m = /^inputs?\s*:\s*(.*)$/i.exec(s))) inputs = list(m[1], line, 'input');
    else if ((m = /^outputs?\s*:\s*(.*)$/i.exec(s))) outputs = list(m[1], line, 'output');
  }
  if (inputs.length > FSM_LIMITS.inputs) throw new Error(`At most ${FSM_LIMITS.inputs} inputs are supported.`);
  if (outputs.length > FSM_LIMITS.outputs) throw new Error(`At most ${FSM_LIMITS.outputs} outputs are supported.`);
  const all = [...inputs, ...outputs];
  if (new Set(all).size !== all.length) throw new Error('Input and output names must all be different.');
  for (const n of all) if (/^[QD]\d$/.test(n)) throw new Error(`"${n}" is reserved for the state flip-flops; pick another name.`);

  const states = [], transitions = [];
  const addState = s => { if (!states.includes(s)) states.push(s); };
  for (const { s, line } of raw) {
    if (/^(inputs?|outputs?)\s*:/i.test(s)) continue;
    const m = /^(\w+)\s*([01x*\s]*?)\s*->\s*(\w+)\s*(?:\/\s*([01,\s]*))?$/i.exec(s);
    if (!m) throw new Error(`Line ${line}: expected "STATE inputs -> NEXT / outputs", got "${s.slice(0, 40)}"`);
    const pattern = m[2].replace(/\s+/g, '').toLowerCase().replace(/\*/g, 'x');
    if (pattern.length !== inputs.length) throw new Error(`Line ${line}: expected ${inputs.length} input bit${inputs.length === 1 ? '' : 's'} (${inputs.join(', ') || 'none'}), got "${pattern}"`);
    const out = (m[4] || '').replace(/[\s,]/g, '') || '0'.repeat(outputs.length);
    if (out.length !== outputs.length) throw new Error(`Line ${line}: expected ${outputs.length} output bit${outputs.length === 1 ? '' : 's'}, got "${out}"`);
    addState(m[1]); addState(m[3]);
    transitions.push({ from: m[1], pattern, to: m[3], out });
  }
  if (!transitions.length) throw new Error('Add at least one transition, e.g.  S0 1 -> S1 / 0');
  if (states.length > FSM_LIMITS.states) throw new Error(`At most ${FSM_LIMITS.states} states are supported.`);
  return { inputs, outputs, states, transitions };
}

// Logic equations for the next-state bits (D0, D1, ...) and the outputs.
function fsmEquations(f) {
  const k = Math.max(1, Math.ceil(Math.log2(f.states.length))), nin = f.inputs.length, nv = k + nin;
  const qNames = Array.from({ length: k }, (_, i) => 'Q' + (k - 1 - i));          // MSB first
  const vars = [...qNames, ...f.inputs];
  const next = Array.from({ length: k }, () => []), outs = f.outputs.map(() => []), dont = [], warnings = [];

  f.states.forEach((st, code) => {
    for (let c = 0; c < 1 << nin; c++) {
      const bits = nin ? c.toString(2).padStart(nin, '0') : '';
      const t = f.transitions.find(t => t.from === st && [...t.pattern].every((p, i) => p === 'x' || p === bits[i]));
      if (!t && f.transitions.some(x => x.from === st)) warnings.push(`State ${st}${nin ? ' with ' + f.inputs.map((n, i) => `${n}=${bits[i]}`).join(' ') : ''} has no transition: it stays put with outputs 0.`);
      const nextCode = t ? f.states.indexOf(t.to) : code, m = (code << nin) | c;
      for (let j = 0; j < k; j++) if ((nextCode >> j) & 1) next[j].push(m);
      f.outputs.forEach((_, o) => { if (t && t.out[o] === '1') outs[o].push(m); });
    }
  });
  for (let code = f.states.length; code < 1 << k; code++) for (let c = 0; c < 1 << nin; c++) dont.push((code << nin) | c);

  const eq = (name, minterms) => {
    const imps = minimizeSOP(nv, minterms, dont);
    return { name, text: `${name} = ${minterms.length === 0 ? '0' : sopToExpr(imps, vars)}`, implicants: imps, minterms };
  };
  const equations = [...next.map((m, j) => eq('D' + j, m)), ...outs.map((m, o) => eq(f.outputs[o], m))];
  return { k, qNames, vars, equations, warnings: [...new Set(warnings)].slice(0, 6), dontCares: dont };
}

// A circuit: inputs on the left, logic, D flip-flops + clock on the right feeding back into the logic.
function buildFsmCircuit(f) {
  const eq = fsmEquations(f);
  const built = buildCircuit(parseProgram(eq.equations.map(e => e.text).join('\n')), { inputOrder: [...f.inputs, ...eq.qNames] });
  return withCircuit(built, () => {
    const find = (type, label) => state.nodes.find(n => n.type === type && n.label === label);
    const maxX = Math.max(...state.nodes.map(n => n.x + geom(n).w)), maxY = Math.max(...state.nodes.map(n => n.y + geom(n).h));
    const clk = addNode('CLOCK', 70, maxY + 70);
    eq.qNames.forEach((q, i) => {
      const j = eq.k - 1 - i, qIn = find('INPUT', q), dLed = find('OUTPUT', 'D' + j);
      const dff = addNode('DFF', maxX + 150, 70 + j * 120);
      for (const w of state.wires) if (w.from === qIn.id) { w.from = dff.id; w.fp = 0; }          // logic now reads the flip-flop
      const src = state.wires.find(w => w.to === dLed.id);
      connect(src.from, src.fp || 0, dff.id, 0);                                                     // the equation feeds D
      connect(clk.id, 0, dff.id, 1);
      removeNodes([qIn.id, dLed.id]);
      connect(dff.id, 0, addNode('OUTPUT', maxX + 310, 70 + j * 120, q).id, 0);                     // show the state bits
    });
    state.counters = { INPUT: state.nodes.filter(n => n.type === 'INPUT').length, OUTPUT: state.nodes.filter(n => n.type === 'OUTPUT').length };
    return state;
  });
}

// SVG state diagram: states on a ring, one arrow per from→to pair labelled "inputs/outputs".
function fsmDiagramSvg(f) {
  const n = f.states.length, R = n === 1 ? 0 : Math.max(80, 34 * n), pad = 100, size = 2 * R + 2 * pad;
  const pos = f.states.map((_, i) => {
    const a = -Math.PI / 2 + i * 2 * Math.PI / n;
    return { x: size / 2 + R * Math.cos(a), y: size / 2 + R * Math.sin(a) };
  });
  const groups = new Map();
  for (const t of f.transitions) {
    const key = t.from + '>' + t.to;
    const label = (f.inputs.length ? t.pattern : '') + (f.outputs.length ? '/' + t.out : '');
    if (!groups.has(key)) groups.set(key, { from: t.from, to: t.to, labels: [] });
    groups.get(key).labels.push(label);
  }
  const r = 24;
  let edges = '';
  for (const g of groups.values()) {
    const a = pos[f.states.indexOf(g.from)], b = pos[f.states.indexOf(g.to)], text = esc(g.labels.join(', '));
    if (g.from === g.to) {
      const dx = a.x - size / 2, dy = a.y - size / 2, d = Math.hypot(dx, dy) || 1, ux = n === 1 ? 0 : dx / d, uy = n === 1 ? -1 : dy / d;   // loop points away from the ring centre
      const px = -uy, py = ux, cx = a.x + ux * (r + 34), cy = a.y + uy * (r + 34);
      const p0 = [a.x + ux * r + px * 9, a.y + uy * r + py * 9], p1 = [a.x + ux * r - px * 9, a.y + uy * r - py * 9];
      edges += `<path class="fsm-edge" d="M${p0[0]} ${p0[1]} C${cx + px * 26} ${cy + py * 26} ${cx - px * 26} ${cy - py * 26} ${p1[0]} ${p1[1]}" marker-end="url(#fsm-arrow)"/>` +
        `<text class="fsm-label" x="${cx + ux * 6}" y="${cy + uy * 6}">${text}</text>`;
    } else {
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
      const cx = mx - dy / d * 34, cy = my + dx / d * 34;                          // bend to the right so A→B and B→A separate
      const toward = (p, c) => { const l = Math.hypot(c.x - p.x, c.y - p.y); return { x: p.x + (c.x - p.x) / l * r, y: p.y + (c.y - p.y) / l * r }; };
      const s = toward(a, { x: cx, y: cy }), e = toward(b, { x: cx, y: cy });
      edges += `<path class="fsm-edge" d="M${s.x} ${s.y} Q${cx} ${cy} ${e.x} ${e.y}" marker-end="url(#fsm-arrow)"/>` +
        `<text class="fsm-label" x="${(mx + cx) / 2}" y="${(my + cy) / 2 - 4}">${text}</text>`;
    }
  }
  const nodes = f.states.map((s, i) => `<circle class="fsm-state${i === 0 ? ' fsm-start' : ''}" cx="${pos[i].x}" cy="${pos[i].y}" r="${r}"/><text class="fsm-name" x="${pos[i].x}" y="${pos[i].y + 4}">${esc(s)}</text>`).join('');
  const start = `<path class="fsm-edge" d="M${pos[0].x - r - 28} ${pos[0].y} H${pos[0].x - r - 2}" marker-end="url(#fsm-arrow)"/>`;
  return `<svg class="fsm-diagram" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="State diagram">` +
    `<defs><marker id="fsm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="fsm-head"/></marker></defs>${edges}${start}${nodes}</svg>`;
}
