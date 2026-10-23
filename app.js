'use strict';
// UI: rendering, interaction, panels, dialogs. Simulation and data live in model.js / expr.js / challenges.js.

const $ = s => document.querySelector(s);
const svg = $('#canvas');
const stage = $('#stage');
const THEME_KEY = 'logic-lab-theme';
const BACKUP_KEY = 'logic-lab-backup';

let view = { x: 0, y: 0, k: 1 };
let selected = null;           // primary selected node id (shown in the info panel)
let sel = new Set();           // all selected node ids
let selWire = null;            // selected wire object
let infoType = 'AND';          // part shown in the reference panel
let drag = null, temp = null, pan = null, box = null, pinch = null;
const pointers = new Map();
let selectMode = false;
let paused = false;
let speedRestore = null, internalSpeed = false;   // an example that forces a speed hands the previous one back when you leave it
let undoStack = [], redoStack = [];
let clipboard = null, pasteCount = 0;
let challengeMsg = null, hintShown = false, tableOpen = false;

// signal propagation modes
let speedMode = 'off', slowTimer = null, pending = false, slowSteps = 0, pulse = new Set();
const clockPhase = new Map();

function selectOnly(id) { sel = id == null ? new Set() : new Set([id]); selected = id; selWire = null; }
const selIds = () => [...sel].filter(id => byId(id));

// ---------------------------------------------------------------- drawing
const curve = (a, b) => {
  const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
  return `M${a.x} ${a.y} C${a.x + dx} ${a.y} ${b.x - dx} ${b.y} ${b.x} ${b.y}`;
};
const curveMid = (a, b) => {
  const dx = Math.max(40, Math.abs(b.x - a.x) / 2);
  return { x: (a.x + 3 * (a.x + dx) + 3 * (b.x - dx) + b.x) / 8, y: (a.y + b.y) / 2 };
};

// Gate symbol for `k` inputs; returns svg (without label) and label x offset.
function gateShape(type, k = GATES[type].ins) {
  const h = k === 1 ? 60 : Math.max(60, 20 * (k + 1)), mid = h / 2, inv = INVERTED.has(type);
  let body, tx = 30, end = 66, inLeads = '';
  switch (type) {
    case 'AND': case 'NAND': body = `<path class="body" d="M0 0H33A33 ${mid} 0 0 1 33 ${h}H0Z"/>`; break;
    case 'OR': case 'NOR': body = `<path class="body" d="M0 0Q30 0 66 ${mid}Q30 ${h} 0 ${h}Q18 ${mid} 0 0Z"/>`; break;
    case 'XOR': case 'XNOR':
      body = `<path class="body" d="M8 0Q36 0 66 ${mid}Q36 ${h} 8 ${h}Q26 ${mid} 8 0Z"/><path class="lead" d="M0 0Q18 ${mid} 0 ${h}"/>`; tx = 34; break;
    default: body = '<path class="body" d="M0 5L60 30L0 55Z"/>'; end = 60; tx = 20;
  }
  if (/OR$/.test(type) && k > 1) inLeads = Array.from({ length: k }, (_, i) => `M0 ${20 * (i + 1)}H12`).join('');
  const bubble = inv ? `<circle class="bubble" cx="${end + 4}" cy="${mid}" r="4"/>` : '';
  const lead = `<path class="lead" d="M${end + (inv ? 8 : 0)} ${mid}H76${inLeads}"/>`;
  return { svg: body + bubble + lead, tx, mid };
}

// Body of a multi-pin chip, user block or bus part: box, title, pin names.
function chipInner(g, pins) {
  let s = `<rect class="body" width="${g.w}" height="${g.h}" rx="6"/><text x="${g.w / 2}" y="-6">${esc(pins.title)}</text>`;
  pins.ins.forEach((l, i) => {
    const y = g.ins[i];
    s += l === 'CLK' ? `<path class="lead" d="M0 ${y - 7}L9 ${y}L0 ${y + 7}"/>` : `<text class="pin" style="text-anchor:start" x="10" y="${y + 3}">${esc(l)}</text>`;
  });
  pins.outs.forEach((l, i) => { const [x, y] = g.outs[i]; s += `<text class="pin" style="text-anchor:end" x="${x - 10}" y="${y + 3}">${esc(l)}</text>`; });
  return s;
}
const hexOf = (v, k) => '0x' + v.toString(16).toUpperCase().padStart(k / 4, '0');

// `plain` draws without selection, highlights or editing affordances (used for read-only views and image export)
function nodeMarkup(n, wired, plain = false) {
  const g = geom(n), on = val(n.id), pins = pinsOf(n);
  const cls = ['node', n.type.toLowerCase(), on ? 'on' : '', !plain && sel.has(n.id) ? 'sel' : '', !plain && pulse.has(n.id) ? 'pulse' : '', IO_TYPES.includes(n.type) ? 'io' : ''].join(' ');
  let inner;
  switch (n.type) {
    case 'INPUT': case 'CLOCK': case 'BUTTON':
      inner = `<rect class="body" width="${g.w}" height="${g.h}" rx="8"/>
        <text class="big" x="${g.w / 2}" y="26">${esc(n.label)} = ${on ? 1 : 0}</text>
        ${n.type === 'CLOCK' ? `<text x="${g.w / 2}" y="-6">⏱ ${n.hz || 1} Hz</text>` : ''}`;
      break;
    case 'OUTPUT':
      inner = `<rect width="${g.w}" height="${g.h}" fill="transparent"/>
        <path class="lead" d="M0 20H11"/>
        <circle class="led" cx="26" cy="20" r="14"/>
        <text x="26" y="-6">${esc(n.label)}</text>
        <text class="big" x="26" y="25" style="fill:${on ? '#0b2a18' : 'var(--dim)'}">${on ? 1 : 0}</text>`;
      break;
    case 'HIGH': case 'LOW':
      inner = `<rect class="body" width="${g.w}" height="${g.h}" rx="6"/>
        <text class="big" x="${g.w / 2}" y="20">${n.type === 'HIGH' ? 1 : 0}</text>`;
      break;
    case 'SEG7': {
      const segs = SEGMENTS.map(([x1, y1, x2, y2], i) => {
        const w = state.wires.find(w => w.to === n.id && w.port === i);
        return `<line class="seg ${w && val(w.from, w.fp || 0) ? 'on' : ''}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
      }).join('');
      inner = `<rect class="body" width="${g.w}" height="${g.h}" rx="6"/>${segs}` +
        [...'abcdefg'].map((c, i) => `<text class="tiny" x="14" y="${15 + 15 * i + 3}">${c}</text>`).join('');
      break;
    }
    case 'BUSIN': case 'BUSOUT': {                                  // multi-bit number input / display
      const k = n.bits === 8 ? 8 : 4;
      const v = n.type === 'BUSIN' ? (n.num || 0)
        : g.ins.reduce((a, _, i) => { const w = state.wires.find(w => w.to === n.id && w.port === i); return a + (w && val(w.from, w.fp || 0) ? 1 << i : 0); }, 0);
      inner = chipInner(g, pins) + `<text class="big" x="${g.w / 2}" y="${g.h / 2 - 2}">${hexOf(v, k)}</text><text class="tiny" x="${g.w / 2}" y="${g.h / 2 + 14}">${v}</text>`;
      break;
    }
    case 'NOTE':
      inner = `<rect class="body note-body" width="${g.w}" height="${g.h}" rx="4"/><text class="note-text" x="${g.w / 2}" y="${g.h / 2 + 4}">${esc(n.text || 'Note')}</text>`;
      break;
    default:
      if (pins) inner = chipInner(g, pins);                         // chips and user blocks
      else {
        const s = gateShape(n.type, inCount(n));
        inner = `${s.svg}<text x="${s.tx}" y="${s.mid + 4}">${n.type === 'BUFFER' ? 'BUF' : n.type}</text>`;
        if (n.delay > 1) inner += `<text class="tiny" x="${g.w - 4}" y="-4" style="text-anchor:end">delay ${n.delay}</text>`;
      }
  }
  const ports = [];
  g.ins.forEach((y, i) => {
    const w = state.wires.find(w => w.to === n.id && w.port === i);
    const v = w && val(w.from, w.fp || 0);
    ports.push(`<circle class="port ${v ? 'on' : ''} ${plain || wired.has(n.id + ':' + i) ? '' : 'float'}" data-port="in" data-node="${n.id}" data-idx="${i}" cx="0" cy="${y}" r="6"><title>${esc(pinName(n, 'in', i))} = ${v ? 1 : 0}${w ? '' : ' (unconnected, reads 0)'}</title></circle>`);
  });
  g.outs.forEach(([x, y], i) => {
    ports.push(`<circle class="port ${val(n.id, i) ? 'on' : ''}" data-port="out" data-node="${n.id}" data-idx="${i}" cx="${x}" cy="${y}" r="6"><title>${esc(pinName(n, 'out', i))} = ${val(n.id, i) ? 1 : 0}</title></circle>`);
  });
  return `<g class="${cls}" data-node="${n.id}" transform="translate(${n.x} ${n.y})">${inner}${ports.join('')}</g>`;
}

// SVG markup for whatever circuit is currently installed as `state` / `sim`.
function circuitMarkup(plain = false) {
  let h = '';
  const wired = new Set(state.wires.map(w => w.to + ':' + w.port));
  state.wires.forEach((w, i) => {
    const a = portPos(byId(w.from), 'out', w.fp || 0), b = portPos(byId(w.to), 'in', w.port);
    const d = curve(a, b), v = val(w.from, w.fp || 0), src = byId(w.from), m = curveMid(a, b), picked = !plain && w === selWire;
    const title = `${w.name ? w.name + ': ' : ''}${src.label || src.type} = ${v ? 1 : 0}`;
    h += `<g class="wire ${v ? 'on' : ''} ${picked ? 'sel' : ''}" data-wire="${i}"><title>${esc(title)}</title><path class="hit" d="${d}"/><path class="line" d="${d}"/></g>`;
    if (w.name) h += `<text class="wname" x="${m.x}" y="${m.y - 7}">${esc(w.name)}</text>`;
    if (picked) h += `<g class="wire-x" data-delwire="${i}" transform="translate(${m.x} ${m.y})"><circle r="9"/><text y="4">✕</text></g>`;
  });
  if (!plain && temp) {
    const d = curve(portPos(byId(temp.from), 'out', temp.fp), { x: temp.x, y: temp.y });
    h += `<g class="wire temp"><path class="line" d="${d}"/></g>`;
  }
  h += state.nodes.map(n => nodeMarkup(n, wired, plain)).join('');
  if (!plain && box) h += `<rect class="selbox" x="${Math.min(box.x0, box.x1)}" y="${Math.min(box.y0, box.y1)}" width="${Math.abs(box.x1 - box.x0)}" height="${Math.abs(box.y1 - box.y0)}"/>`;
  return h;
}

function render() {
  svg.innerHTML = `<g transform="translate(${view.x} ${view.y}) scale(${view.k})">${circuitMarkup()}</g>`;
  stage.style.backgroundSize = `${20 * view.k}px ${20 * view.k}px`;
  stage.style.backgroundPosition = `${view.x}px ${view.y}px`;
  $('#zoom-label').textContent = Math.round(view.k * 100) + '%';
  $('#empty').style.display = state.nodes.length ? 'none' : 'flex';
}

// ---------------------------------------------------------------- side panels
const bit = v => `<td class="${v ? 'one' : ''}">${v ? 1 : 0}</td>`;

function renderGateInfo() {
  const node = selected != null ? byId(selected) : null;
  if (node) infoType = node.type === 'BLOCK' ? 'BLOCK:' + node.block : node.type;
  document.querySelectorAll('.item[data-type]').forEach(i => i.classList.toggle('active', i.dataset.type === infoType));
  const el = $('#gate-info');

  if (isGate(infoType)) {
    const g = GATES[infoType];
    const k = node && node.type === infoType ? inCount(node) : g.ins;
    const names = letters(k);
    const rows = combos(k).map(c => `<tr>${c.map(bit).join('')}${bit(g.fn(c))}</tr>`).join('');
    const ctl = node && node.type === infoType && g.multi
      ? `<div class="stepper">Inputs <button data-act="dec" ${k <= 2 ? 'disabled' : ''}>−</button><b>${k}</b><button data-act="inc" ${k >= MAX_INPUTS ? 'disabled' : ''}>+</button></div>` : '';
    const dly = node && node.type === infoType ? node.delay || 1 : 0;
    const dctl = dly ? `<div class="stepper" title="Propagation delay in gate delays. Only used in Slow-mo and Step-by-step modes.">Delay <button data-act="ddec" ${dly <= 1 ? 'disabled' : ''}>−</button><b>${dly}</b><button data-act="dinc" ${dly >= MAX_DELAY ? 'disabled' : ''}>+</button></div>` : '';
    el.innerHTML = `<h3>${infoType}</h3><code>Y = ${g.expr(names)}</code><p>${g.desc}</p>${ctl}${dctl}
      <table><tr>${names.map(x => `<th>${x}</th>`).join('')}<th>Y</th></tr>${rows}</table>`;
  } else if (CHIPS[infoType]) {
    const c = CHIPS[infoType];
    const extra = infoType === 'DFF'
      ? '<table><tr><th>D</th><th>CLK</th><th>Q next</th></tr><tr><td>0</td><td>↑</td><td>0</td></tr><tr><td>1</td><td>↑</td><td class="one">1</td></tr><tr><td>x</td><td>0/1/↓</td><td>Q (hold)</td></tr></table>' : '';
    el.innerHTML = `<h3>${c.title}</h3><code>${c.ins.join(', ')} → ${c.outs.join(', ')}</code><p>${c.desc}</p>${extra}`;
  } else if (infoType.startsWith('BLOCK:')) {
    const name = infoType.slice(6), d = BLOCKS.get(name);
    el.innerHTML = d ? `<h3>${esc(name)}</h3><code>${d.insLabels.map(esc).join(', ')} → ${d.outsLabels.map(esc).join(', ')}</code>
      <p>Your saved block (${d.nodes.length} parts inside). Drag it from <b>My blocks</b> to reuse it; it behaves exactly like the circuit you saved.</p>
      <button data-act="delblock" data-name="${esc(name)}">Delete block</button>` : '';
  } else if (PART_INFO[infoType]) {
    const [title, desc] = PART_INFO[infoType];
    const ctl = node && node.type === 'CLOCK'
      ? `<div class="stepper">Speed <select data-act="hz">${CLOCK_RATES.map(r => `<option value="${r}" ${r === (node.hz || 1) ? 'selected' : ''}>${r} Hz</option>`).join('')}</select></div>` : '';
    const bctl = node && (node.type === 'BUSIN' || node.type === 'BUSOUT')
      ? `<div class="stepper">Width <select data-act="bits">${BUS_WIDTHS.map(b => `<option value="${b}" ${b === (node.bits || 4) ? 'selected' : ''}>${b} bits</option>`).join('')}</select></div>` : '';
    el.innerHTML = `<h3>${title}</h3><p>${desc}</p>${ctl}${bctl}`;
  } else el.innerHTML = '';
  if (node) el.insertAdjacentHTML('beforeend', wiringHtml(node));
}

// Pin-by-pin wiring through menus: the keyboard / screen-reader alternative to dragging wires.
const nodeName = n => n.label || `${n.type === 'BLOCK' ? n.block : n.type} #${n.id}`;
function wiringHtml(n) {
  const g = geom(n);
  if (!g.ins.length) return '';
  const sources = [];
  for (const m of state.nodes) geom(m).outs.forEach((_, k) => sources.push({ key: `${m.id}:${k}`, text: nodeName(m) + (geom(m).outs.length > 1 ? '.' + pinName(m, 'out', k) : '') }));
  const rows = g.ins.map((_, i) => {
    const w = state.wires.find(w => w.to === n.id && w.port === i);
    const cur = w ? `${w.from}:${w.fp || 0}` : '', pin = esc(pinName(n, 'in', i));
    return `<label>${pin}<select data-act="wire" data-pin="${i}" aria-label="Source for input ${pin} of ${esc(nodeName(n))}"><option value="">— unconnected —</option>` +
      sources.slice(0, 300).map(s => `<option value="${s.key}" ${s.key === cur ? 'selected' : ''}>${esc(s.text)}</option>`).join('') + '</select></label>';
  }).join('');
  return `<h3>Wiring</h3><div class="wiring">${rows}</div>`;
}

$('#gate-info').addEventListener('click', e => {
  const act = e.target.dataset.act, n = selected != null && byId(selected);
  if (act === 'delblock') {
    if (!confirm(`Delete the block "${e.target.dataset.name}"? This cannot be undone.`)) return;
    const r = deleteBlock(e.target.dataset.name);
    if (r.error) return toast(r.error);
    infoType = 'AND'; buildPalette(); renderGateInfo(); return;
  }
  if (n && (act === 'dinc' || act === 'ddec')) {
    const d = Math.min(MAX_DELAY, Math.max(1, (n.delay || 1) + (act === 'dinc' ? 1 : -1)));
    record();
    if (d > 1) n.delay = d; else delete n.delay;
    delete sim.mem[n.id];
    changed();
    return;
  }
  if (!n || (act !== 'inc' && act !== 'dec')) return;
  const k = Math.min(MAX_INPUTS, Math.max(2, inCount(n) + (act === 'inc' ? 1 : -1)));
  if (k === inCount(n)) return;
  record();
  n.n = k;
  state.wires = state.wires.filter(w => !(w.to === n.id && w.port >= k));
  changed();
});
$('#gate-info').addEventListener('change', e => {
  const n = selected != null && byId(selected);
  if (e.target.dataset.act === 'hz' && n && n.type === 'CLOCK') { record(); n.hz = +e.target.value; clockPhase.delete(n.id); changed(); }
  if (e.target.dataset.act === 'bits' && n && (n.type === 'BUSIN' || n.type === 'BUSOUT')) {
    const bits = +e.target.value;
    record();
    n.bits = bits;
    if (n.type === 'BUSIN') n.num = (n.num || 0) & ((1 << bits) - 1);
    state.wires = state.wires.filter(w => !(w.to === n.id && w.port >= bits) && !(w.from === n.id && (w.fp || 0) >= bits));
    changed();
  }
  if (e.target.dataset.act === 'wire' && n) {
    const pin = +e.target.dataset.pin, v = e.target.value;
    record();
    if (!v) state.wires = state.wires.filter(w => !(w.to === n.id && w.port === pin));
    else { const [from, fp] = v.split(':').map(Number); connect(from, fp, n.id, pin); }
    changed();
    announce(v ? `${pinName(n, 'in', pin)} of ${nodeName(n)} connected. ${outputSummary()}` : `${pinName(n, 'in', pin)} of ${nodeName(n)} disconnected.`);
    const again = $('#gate-info').querySelector(`select[data-act="wire"][data-pin="${pin}"]`);   // the panel re-rendered; keep keyboard focus
    if (again) again.focus();
  }
});

// ---------------------------------------------------------------- screen-reader announcements
let announceFlip = false;
function announce(msg) { announceFlip = !announceFlip; $('#sr').textContent = msg + (announceFlip ? '' : '​'); }
const outputSummary = () => {
  const outs = state.nodes.filter(n => n.type === 'OUTPUT');
  return outs.length ? outs.map(o => `${o.label} is ${val(o.id) ? 1 : 0}`).join(', ') + '.' : '';
};
function announceNode(n) {
  const g = geom(n);
  const outs = g.outs.map((_, k) => `${pinName(n, 'out', k)} ${val(n.id, k) ? 1 : 0}`).join(', ');
  announce(`${nodeName(n)} selected${outs ? ', output ' + outs : ''}. ${g.ins.length ? 'Wire its inputs in the info panel.' : ''}`);
}

// Keyboard navigation of the canvas: ] [ select next/previous part, arrows move it, Enter/Space flips a switch.
function keyNav(e) {
  if (e.target !== svg && e.target !== document.body) return false;
  const ordered = [...state.nodes].sort((a, b) => a.x - b.x || a.y - b.y);
  if (e.key === ']' || e.key === '[') {
    if (!ordered.length) return true;
    const cur = ordered.findIndex(n => n.id === selected);
    const next = ordered[(cur + (e.key === ']' ? 1 : -1) + ordered.length) % ordered.length];
    selectOnly(next.id); renderGateInfo(); render(); announceNode(next);
    return true;
  }
  const n = selected != null && byId(selected);
  if (!n) { if (e.key === ' ') { togglePause(); return true; } return false; }
  const step = (e.shiftKey ? 5 : 1) * GRID;
  const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (d) { record(); n.x += d[0]; n.y += d[1]; changed(); return true; }
  if ((e.key === 'Enter' || e.key === ' ') && activate(n)) {
    changed(true);
    announce(`${nodeName(n)} is now ${n.type === 'BUSIN' ? n.num : n.value ? 1 : 0}. ${outputSummary()}`);
    return true;
  }
  return false;
}

function renderTruth() {
  const ins = state.nodes.filter(n => n.type === 'INPUT');
  const os = state.nodes.filter(n => n.type === 'OUTPUT');
  const el = $('#truth');
  if (!ins.length || !os.length) { el.innerHTML = '<p class="hint">Add at least one switch and one LED.</p>'; return; }
  if (ins.length > 5) { el.innerHTML = '<p class="hint">Too many switches (max 5) for a table.</p>'; return; }
  const cur = ins.map(n => !!n.value);
  const rows = sweep(ins, c => `<tr class="${c.every((v, i) => v === cur[i]) ? 'cur' : ''}">${c.map(bit).join('')}${os.map(o => bit(val(o.id))).join('')}</tr>`).join('');
  el.innerHTML = `<table><tr>${ins.map(n => `<th>${esc(n.label)}</th>`).join('')}${os.map(n => `<th>${esc(n.label)}</th>`).join('')}</tr>${rows}</table>
    <p class="hint">Circuits with memory (latches, flip-flops) depend on history, so rows may not tell the whole story.</p>`;
}

function renderStatus() {
  const parts = state.nodes.filter(n => !IO_TYPES.includes(n.type)).length;
  const wired = new Set(state.wires.map(w => w.to + ':' + w.port));
  const floating = state.nodes.reduce((c, n) => c + geom(n).ins.filter((_, i) => !wired.has(n.id + ':' + i)).length, 0);
  $('#status').innerHTML = `${parts} part${parts === 1 ? '' : 's'} · ${state.wires.length} wire${state.wires.length === 1 ? '' : 's'} · ` +
    (pending ? `<span class="warn">● propagating (gate delay ${slowSteps})${speedMode === 'manual' ? ' — press Step' : ''}</span>`
      : stable ? '<span class="ok">● stable</span>' : '<span class="bad">● unstable (oscillating loop)</span>') +
    (floating ? ` · <span class="warn">⚠ ${floating} unconnected input${floating === 1 ? '' : 's'} (read as 0)</span>` : '');
  $('#undo').disabled = !undoStack.length;
  $('#redo').disabled = !redoStack.length;
}

function renderChallenge() {
  const el = $('#challenge'), c = activeChallenge;
  if (!c) { el.innerHTML = ''; return; }
  const next = CHALLENGES[CHALLENGES.indexOf(c) + 1];
  el.innerHTML = `<div class="card">
    <b>${esc(c.title)}</b> <span class="tag">${c.level}</span>
    <p>${c.learn}</p>
    ${c.allowed ? `<p class="warn">Allowed gates: ${c.allowed.join(', ')}</p>` : ''}
    <details ${tableOpen ? 'open' : ''}><summary>Target truth table</summary>${challengeTable(c)}</details>
    ${hintShown ? `<p><b>Hint:</b> ${esc(c.hint)}</p>` : ''}
    <div class="row"><button data-act="check">✔ Check</button>${hintShown ? '' : '<button data-act="hint">Hint</button>'}<button data-act="exit">Exit</button>${challengeMsg && challengeMsg.ok && next ? '<button data-act="next">Next ▶</button>' : ''}</div>
    ${challengeMsg ? `<div class="result ${challengeMsg.ok ? 'ok' : 'bad'}">${challengeMsg.ok ? '✅ ' : '❌ '}${esc(challengeMsg.msg)}</div>` : ''}
  </div>`;
}
$('#challenge').addEventListener('toggle', e => { tableOpen = e.target.open; }, true);
$('#challenge').addEventListener('click', e => {
  const act = e.target.dataset.act;
  if (!act || !activeChallenge) return;
  if (act === 'check') {
    challengeMsg = checkChallenge(activeChallenge);
    if (challengeMsg.ok) markDone(activeChallenge.id);
  } else if (act === 'hint') hintShown = true;
  else if (act === 'exit') { activeChallenge = null; save(); }
  else if (act === 'next') { loadChallenge(CHALLENGES[CHALLENGES.indexOf(activeChallenge) + 1]); return; }
  renderChallenge();
});

// ---------------------------------------------------------------- change pipeline
let saveWarned = false;
function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ version: SCHEMA_VERSION, ...state, view, challenge: activeChallenge && activeChallenge.id })); }
  catch {
    if (!saveWarned) { saveWarned = true; toast('Autosave is unavailable (storage full or blocked). Use Export to keep your work.'); }
  }
}

function refresh() {
  render(); renderGateInfo(); if (!pending) renderTruth(); renderStatus(); renderChallenge(); sampleSignals();
  if (typeof renderBlockView === 'function') renderBlockView();
}

// `viaSignal`: a switch/clock/button changed. In slow modes the effect then ripples one gate delay at a time.
function changed(viaSignal = false) {
  if (viaSignal && speedMode !== 'off') startSlow();
  else { stopSlow(); evalAll(); }
  refresh();
  save();
}

function startSlow() {
  pending = true; slowSteps = 0;
  if (speedMode === 'slow' && !slowTimer) slowTimer = setInterval(slowStep, 450);
}
function stopSlow() {
  clearInterval(slowTimer); slowTimer = null;
  pending = false; pulse = new Set();
}
function slowStep() {
  pulse = new Set();
  const ch = pass(state.nodes, state.wires, sim, true, pulse);
  slowSteps++;
  if (!ch || slowSteps >= 60) { stable = !ch; stopSlow(); renderTruth(); save(); } else pending = true;
  render(); renderStatus(); sampleSignals();
}

// ---------------------------------------------------------------- undo / redo
function record() {
  stopDemo();
  challengeMsg = null;
  $('#examples').value = '';   // circuit is being edited, so it no longer matches the example
  undoStack.push(JSON.stringify(state));
  if (undoStack.length > 100) undoStack.shift();
  redoStack = [];
}
function restore(json) {
  $('#examples').value = '';
  state = JSON.parse(json);
  sim = newSim();
  sel = new Set(selIds()); if (selected != null && !byId(selected)) selected = null; selWire = null;
  changed();
}
function undo() { if (undoStack.length) { redoStack.push(JSON.stringify(state)); restore(undoStack.pop()); } }
function redo() { if (redoStack.length) { undoStack.push(JSON.stringify(state)); restore(redoStack.pop()); } }

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.style.display = 'block';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.display = 'none'; }, 3200);
}

// ---------------------------------------------------------------- pointer interaction
const screen = e => { const r = svg.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
const pt = e => { const s = screen(e); return { x: (s.x - view.x) / view.k, y: (s.y - view.y) / view.k }; };

function zoomAt(sx, sy, f) {
  const k = Math.min(3, Math.max(0.3, view.k * f));
  const wx = (sx - view.x) / view.k, wy = (sy - view.y) / view.k;
  view = { k, x: sx - wx * k, y: sy - wy * k };
  render(); save();
}
svg.addEventListener('wheel', e => { e.preventDefault(); const s = screen(e); zoomAt(s.x, s.y, e.deltaY < 0 ? 1.1 : 1 / 1.1); }, { passive: false });

function beginPinch() {
  drag = temp = pan = box = null;
  const [a, b] = [...pointers.values()];
  pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  render();
}

// Click / Enter on a switch flips it; on a number input it counts up by one. Returns whether anything changed.
function activate(n) {
  if (n.type === 'INPUT') { n.value = !n.value; return true; }
  if (n.type === 'BUSIN') { n.num = ((n.num || 0) + 1) & ((1 << (n.bits || 4)) - 1); return true; }
  return false;
}

function deleteSelection() {
  if (selWire) { record(); state.wires = state.wires.filter(w => w !== selWire); selWire = null; changed(); return; }
  const ids = selIds();
  if (!ids.length) return;
  record(); removeNodes(ids); selectOnly(null); changed();
}

svg.addEventListener('pointerdown', e => {
  stopDemo();
  closeDrawers();
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) { beginPinch(); return; }
  if (pointers.size > 2) return;
  const p = pt(e), t = e.target;

  const delWire = t.closest('[data-delwire]');
  if (delWire) { record(); state.wires.splice(+delWire.dataset.delwire, 1); selWire = null; changed(); return; }

  const port = t.closest('[data-port]');
  if (port) {
    const id = +port.dataset.node, idx = +port.dataset.idx;
    if (port.dataset.port === 'out') temp = { from: id, fp: idx, x: p.x, y: p.y };
    else {
      // grab an existing wire off this input to re-route it
      const i = state.wires.findIndex(w => w.to === id && w.port === idx);
      if (i < 0) return;
      record();
      temp = { from: state.wires[i].from, fp: state.wires[i].fp || 0, x: p.x, y: p.y, recorded: true };
      state.wires.splice(i, 1);
      evalAll();
    }
    svg.setPointerCapture(e.pointerId);
    render();
    return;
  }

  const wireEl = t.closest('[data-wire]');
  if (wireEl) { selectOnly(null); selWire = state.wires[+wireEl.dataset.wire]; renderGateInfo(); render(); return; }

  const nodeEl = t.closest('[data-node]');
  if (nodeEl) {
    const n = byId(+nodeEl.dataset.node);
    if (e.shiftKey) {                                           // add to / remove from the selection
      if (sel.has(n.id)) { sel.delete(n.id); if (selected === n.id) selected = null; } else { sel.add(n.id); selected = n.id; }
      selWire = null; renderGateInfo(); render(); return;
    }
    if (!sel.has(n.id)) selectOnly(n.id); else { selected = n.id; selWire = null; }
    const ids = selIds();
    drag = { n, ids, starts: new Map(ids.map(id => [id, { x: byId(id).x, y: byId(id).y }])), sx: p.x, sy: p.y, moved: false, hold: null };
    if (n.type === 'BUTTON') { n.value = true; drag.hold = n; changed(true); }
    svg.setPointerCapture(e.pointerId);
    renderGateInfo(); render();
    return;
  }

  // background
  if (e.shiftKey || selectMode) box = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, add: e.shiftKey };
  else { selectOnly(null); pan = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }; }
  svg.setPointerCapture(e.pointerId);
  renderGateInfo(); render();
});

svg.addEventListener('pointermove', e => {
  if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch) {
    if (pointers.size < 2) return;
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y) || 1, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, r = svg.getBoundingClientRect();
    view.x += mx - pinch.mx; view.y += my - pinch.my;
    zoomAt(mx - r.left, my - r.top, d / pinch.d);
    pinch = { d, mx, my };
    return;
  }
  const p = pt(e);
  if (temp) { temp.x = p.x; temp.y = p.y; render(); }
  else if (pan) { view.x = pan.vx + e.clientX - pan.sx; view.y = pan.vy + e.clientY - pan.sy; render(); }
  else if (box) { box.x1 = p.x; box.y1 = p.y; render(); }
  else if (drag) {
    if (!drag.moved) {
      if (Math.hypot(p.x - drag.sx, p.y - drag.sy) * view.k < 4) return;
      drag.moved = true;
      record();
      if (drag.hold) { drag.hold.value = false; drag.hold = null; changed(true); }   // moving a button is not a press
    }
    for (const id of drag.ids) {
      const s = drag.starts.get(id), n = byId(id);
      n.x = snap(s.x + p.x - drag.sx); n.y = snap(s.y + p.y - drag.sy);
    }
    render();
  }
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pinch) { if (pointers.size < 2) pinch = null; return; }
  if (temp) {
    const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-port="in"]');
    if (hit) {
      if (!temp.recorded) record();
      connect(temp.from, temp.fp, +hit.dataset.node, +hit.dataset.idx);
    }
    temp = null;
    changed();
  } else if (pan) {
    pan = null; save();
  } else if (box) {
    const x0 = Math.min(box.x0, box.x1), x1 = Math.max(box.x0, box.x1), y0 = Math.min(box.y0, box.y1), y1 = Math.max(box.y0, box.y1);
    const hit = state.nodes.filter(n => { const g = geom(n); return n.x < x1 && n.x + g.w > x0 && n.y < y1 && n.y + g.h > y0; }).map(n => n.id);
    sel = box.add ? new Set([...sel, ...hit]) : new Set(hit);
    selected = sel.size === 1 ? [...sel][0] : null;
    box = null;
    renderGateInfo(); render();
  } else if (drag) {
    const { n, moved, hold } = drag;
    drag = null;
    if (hold) { hold.value = false; changed(true); }
    else if (moved) changed();
    else {
      if (sel.size > 1) selectOnly(n.id);                       // plain click inside a group narrows to that part
      if (activate(n)) changed(true); else changed();
    }
  }
}
svg.addEventListener('pointerup', endPointer);
svg.addEventListener('pointercancel', endPointer);

svg.addEventListener('dblclick', e => {
  const nodeEl = e.target.closest('[data-node]');
  if (nodeEl) {
    const n = byId(+nodeEl.dataset.node);
    if (n && n.type === 'BLOCK') { openBlockView(n.id); return; }
    if (n && n.type === 'NOTE') {
      const text = prompt('Note text (max 80 characters):', n.text || '');
      if (text !== null && text.trim()) { record(); n.text = text.trim().slice(0, 80); changed(); }
      return;
    }
    if (n && n.type === 'BUSIN') {
      const k = n.bits || 4, max = (1 << k) - 1;
      const raw = prompt(`Value from 0 to ${max} (decimal, or hex like 0xA):`, String(n.num || 0));
      const v = raw === null ? NaN : /^\s*0x[0-9a-f]+\s*$/i.test(raw) ? parseInt(raw, 16) : /^\s*\d+\s*$/.test(raw) ? parseInt(raw, 10) : NaN;
      if (Number.isFinite(v) && v >= 0 && v <= max) { record(); n.num = v; changed(true); } else if (raw !== null) toast(`Enter a whole number from 0 to ${max}.`);
      return;
    }
    if (!n || !(n.type === 'INPUT' || n.type === 'OUTPUT' || n.type === 'BUTTON')) return;
    const name = prompt('Label (max 6 characters):', n.label);
    if (name && name.trim() && name.trim().slice(0, 6) !== n.label) { record(); n.label = name.trim().slice(0, 6); changed(); }
    return;
  }
  const wireEl = e.target.closest('[data-wire]');
  const w = wireEl && state.wires[+wireEl.dataset.wire];
  if (w) {
    const name = prompt('Name this signal (max 12 characters, empty to clear):', w.name || '');
    if (name === null) return;
    record();
    if (name.trim()) w.name = name.trim().slice(0, 12); else delete w.name;
    changed();
  }
});

// ---------------------------------------------------------------- copy / paste
function copySelection() {
  const ids = new Set(selIds());
  if (!ids.size) return false;
  clipboard = {
    nodes: state.nodes.filter(n => ids.has(n.id)).map(n => JSON.parse(JSON.stringify(n))),
    wires: state.wires.filter(w => ids.has(w.from) && ids.has(w.to)).map(w => ({ ...w })),
  };
  pasteCount = 0;
  return true;
}
function pasteClipboard() {
  if (!clipboard) return;
  record();
  const off = GRID * 4 * ++pasteCount, map = new Map();
  for (const n of clipboard.nodes) {
    const c = { ...JSON.parse(JSON.stringify(n)), id: state.nextId++, x: n.x + off, y: n.y + off };
    state.nodes.push(c); map.set(n.id, c.id);
  }
  for (const w of clipboard.wires) state.wires.push({ ...w, from: map.get(w.from), to: map.get(w.to) });
  sel = new Set(map.values()); selected = sel.size === 1 ? [...sel][0] : null; selWire = null;
  changed();
}

document.addEventListener('keydown', e => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) || document.querySelector('dialog[open]')) return;
  const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase();
  if (!mod && !e.altKey && keyNav(e)) { e.preventDefault(); return; }
  if (mod && key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if (mod && key === 'y') { e.preventDefault(); redo(); }
  else if (mod && key === 'c') { if (copySelection()) { e.preventDefault(); toast(`Copied ${sel.size} part${sel.size === 1 ? '' : 's'}`); } }
  else if (mod && key === 'v') { e.preventDefault(); pasteClipboard(); }
  else if (mod && key === 'd') { e.preventDefault(); if (copySelection()) pasteClipboard(); }
  else if (mod && key === 'a') { e.preventDefault(); sel = new Set(state.nodes.map(n => n.id)); selected = null; renderGateInfo(); render(); }
  else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelection();
  else if (e.key === 'Escape') { closeDrawers(); selectOnly(null); renderGateInfo(); render(); }
});

// ---------------------------------------------------------------- palette (HTML5 drag & drop + double-click)
function addPart(typeStr, x, y) {
  let type = typeStr, extra;
  if (typeStr.startsWith('BLOCK:')) {
    type = 'BLOCK';
    if (!BLOCKS.has(typeStr.slice(6))) return null;
    extra = { block: typeStr.slice(6) };
  } else if (!PARTS.has(typeStr) || typeStr === 'BLOCK') return null;
  record();
  const n = addNode(type, x, y, undefined, extra);
  selectOnly(n.id);
  changed();
  return n;
}

let placeCount = 0;
const narrowScreen = () => window.matchMedia('(max-width: 900px)').matches;
const closeDrawers = () => document.body.classList.remove('show-palette', 'show-info');

// Drop a part in the middle of the visible canvas (touch- and keyboard-friendly alternative to dragging).
function placeFromPalette(type) {
  const k = placeCount++ % 5 * 20;
  const n = addPart(type, (svg.clientWidth / 2 - view.x) / view.k + k, (svg.clientHeight / 2 - view.y) / view.k + k);
  if (n) { announce(`${nodeName(n)} added and selected.`); closeDrawers(); }
}

function buildPalette() {
  for (const id of ['#io-items', '#gate-items', '#chip-items', '#block-items']) $(id).innerHTML = '';
  const add = (parent, type, inner, onDelete) => {
    const el = document.createElement('div');
    el.className = 'item';
    el.draggable = true;
    el.dataset.type = type;
    el.innerHTML = inner;
    el.addEventListener('dragstart', ev => ev.dataTransfer.setData('text/plain', type));
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', `Add ${el.textContent.trim() || type} to the canvas`);
    el.addEventListener('click', () => {
      infoType = type; renderGateInfo();
      if (narrowScreen()) placeFromPalette(type);     // no drag-and-drop on touch: a tap places the part
    });
    el.addEventListener('dblclick', () => placeFromPalette(type));
    el.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); placeFromPalette(type); } });
    parent.appendChild(el);
  };
  const txt = s => `<div class="txt">${s}</div>`;
  for (const [t, label] of [['INPUT', 'Switch'], ['BUTTON', 'Button'], ['CLOCK', 'Clock'], ['OUTPUT', 'LED'], ['HIGH', 'Const 1'], ['LOW', 'Const 0'], ['SEG7', '7-Segment'], ['BUSIN', 'Number in'], ['BUSOUT', 'Number out'], ['NOTE', 'Note']]) add($('#io-items'), t, txt(label));
  for (const t of Object.keys(GATES)) add($('#gate-items'), t, `<svg viewBox="-4 -2 84 64" fill="none" style="--off:#8a94a9"><g class="node">${gateShape(t).svg}</g></svg>${t}`);
  for (const [t, label] of [['DFF', 'D-FF'], ['TFF', 'T-FF'], ['JKFF', 'JK-FF'], ['REG4', 'Register'], ['MUX2', 'Mux 2:1'], ['DEC24', 'Decoder'], ['BCD7', 'Hex→7seg'], ['DLATCH', 'D latch'], ['SHIFT4', 'Shift reg'], ['COUNTER4', 'Counter'], ['ADD4', 'Adder 4-bit'], ['ALU4', 'ALU 4-bit']]) add($('#chip-items'), t, txt(label));
  for (const name of BLOCKS.keys()) add($('#block-items'), 'BLOCK:' + name, txt(esc(name)));
  if (!BLOCKS.size) $('#block-items').innerHTML = '<p class="hint" style="grid-column:1/-1;margin:0">Select parts (⬚ Select) then 📦 Save block.</p>';
  if (typeof filterPalette === 'function') filterPalette($('#palette-search').value);
}

stage.addEventListener('dragover', e => e.preventDefault());
stage.addEventListener('drop', e => {
  e.preventDefault();
  const p = pt(e);
  addPart(e.dataTransfer.getData('text/plain'), p.x, p.y);
});

// ---------------------------------------------------------------- examples
// nodes: [key, type, x, y, label?, opts?]   wires: [from, to, toPort, fromPort = 0]
function adder4() {
  const nodes = [['cin', 'LOW', 10, 210]], wires = [];
  for (let i = 0; i < 4; i++) {
    const X = 90 + i * 210, k = s => s + i;
    nodes.push(
      [k('a'), 'INPUT', X, 10, 'A' + i], [k('b'), 'INPUT', X + 100, 10, 'B' + i],
      [k('x1'), 'XOR', X, 100], [k('n1'), 'AND', X + 100, 100],
      [k('x2'), 'XOR', X, 200], [k('n2'), 'AND', X + 100, 200],
      [k('o'), 'OR', X + 100, 300], [k('s'), 'OUTPUT', X + 8, 320, 'S' + i]);
    const carry = i === 0 ? 'cin' : 'o' + (i - 1);
    wires.push([k('a'), k('x1'), 0], [k('b'), k('x1'), 1], [k('a'), k('n1'), 0], [k('b'), k('n1'), 1],
      [k('x1'), k('x2'), 0], [carry, k('x2'), 1], [k('x1'), k('n2'), 0], [carry, k('n2'), 1],
      [k('n1'), k('o'), 0], [k('n2'), k('o'), 1], [k('x2'), k('s'), 0]);
  }
  nodes.push(['cout', 'OUTPUT', 90 + 3 * 210 + 200, 320, 'COUT']);
  wires.push(['o3', 'cout', 0]);
  return { nodes, wires };
}

const EXAMPLES = {
  'Half adder (XOR + AND)': {
    nodes: [['a', 'INPUT', 40, 60, 'A'], ['b', 'INPUT', 40, 170, 'B'], ['x', 'XOR', 220, 50], ['n', 'AND', 220, 160],
            ['s', 'OUTPUT', 400, 70, 'SUM'], ['c', 'OUTPUT', 400, 180, 'CARRY']],
    wires: [['a', 'x', 0], ['b', 'x', 1], ['a', 'n', 0], ['b', 'n', 1], ['x', 's', 0], ['n', 'c', 0]],
  },
  'Full adder': {
    nodes: [['a', 'INPUT', 30, 40, 'A'], ['b', 'INPUT', 30, 130, 'B'], ['ci', 'INPUT', 30, 250, 'CIN'],
            ['x1', 'XOR', 170, 70], ['x2', 'XOR', 330, 110], ['a1', 'AND', 170, 160], ['a2', 'AND', 330, 210],
            ['o', 'OR', 480, 190], ['s', 'OUTPUT', 520, 100, 'SUM'], ['co', 'OUTPUT', 600, 200, 'COUT']],
    wires: [['a', 'x1', 0], ['b', 'x1', 1], ['x1', 'x2', 0], ['ci', 'x2', 1], ['a', 'a1', 0], ['b', 'a1', 1],
            ['x1', 'a2', 0], ['ci', 'a2', 1], ['a1', 'o', 0], ['a2', 'o', 1], ['x2', 's', 0], ['o', 'co', 0]],
  },
  '4-bit adder (ripple carry)': adder4,
  '2:1 multiplexer (from gates)': {
    nodes: [['a', 'INPUT', 30, 40, 'A'], ['b', 'INPUT', 30, 130, 'B'], ['s', 'INPUT', 30, 230, 'S'], ['ns', 'NOT', 170, 230],
            ['a1', 'AND', 300, 50], ['a2', 'AND', 300, 150], ['o', 'OR', 450, 100], ['y', 'OUTPUT', 580, 115, 'Y']],
    wires: [['s', 'ns', 0], ['a', 'a1', 0], ['ns', 'a1', 1], ['b', 'a2', 0], ['s', 'a2', 1], ['a1', 'o', 0], ['a2', 'o', 1], ['o', 'y', 0]],
  },
  'Parity checker (4-input XOR)': {
    nodes: [...'ABCD'].map((c, i) => ['i' + i, 'INPUT', 30, 30 + i * 70, c]).concat([
      ['x', 'XOR', 230, 100, undefined, { n: 4 }], ['odd', 'OUTPUT', 400, 120, 'ODD'], ['nt', 'NOT', 380, 220], ['even', 'OUTPUT', 520, 235, 'EVEN']]),
    wires: [0, 1, 2, 3].map(i => ['i' + i, 'x', i]).concat([['x', 'odd', 0], ['x', 'nt', 0], ['nt', 'even', 0]]),
  },
  '3-input majority voter': {
    nodes: [['a', 'INPUT', 30, 40, 'A'], ['b', 'INPUT', 30, 130, 'B'], ['c', 'INPUT', 30, 220, 'C'],
            ['ab', 'AND', 180, 30], ['bc', 'AND', 180, 130], ['ac', 'AND', 180, 230],
            ['or', 'OR', 340, 120, undefined, { n: 3 }], ['y', 'OUTPUT', 480, 135, 'MAJ']],
    wires: [['a', 'ab', 0], ['b', 'ab', 1], ['b', 'bc', 0], ['c', 'bc', 1], ['a', 'ac', 0], ['c', 'ac', 1],
            ['ab', 'or', 0], ['bc', 'or', 1], ['ac', 'or', 2], ['or', 'y', 0]],
  },
  'NAND is universal (AND/OR)': {
    nodes: [['a', 'INPUT', 30, 60, 'A'], ['b', 'INPUT', 30, 150, 'B'],
            ['n1', 'NAND', 180, 40], ['na', 'NAND', 180, 160], ['nb', 'NAND', 180, 250],
            ['and', 'NAND', 330, 40], ['or', 'NAND', 330, 190],
            ['oa', 'OUTPUT', 480, 55, 'A·B'], ['oo', 'OUTPUT', 480, 205, 'A+B']],
    wires: [['a', 'n1', 0], ['b', 'n1', 1], ['a', 'na', 0], ['a', 'na', 1], ['b', 'nb', 0], ['b', 'nb', 1],
            ['n1', 'and', 0], ['n1', 'and', 1], ['na', 'or', 0], ['nb', 'or', 1], ['and', 'oa', 0], ['or', 'oo', 0]],
  },
  'SR latch (NOR, memory!)': {
    nodes: [['r', 'INPUT', 40, 50, 'R'], ['s', 'INPUT', 40, 200, 'S'], ['n1', 'NOR', 250, 50], ['n2', 'NOR', 250, 190],
            ['q', 'OUTPUT', 430, 60, 'Q'], ['qn', 'OUTPUT', 430, 200, 'Q̄']],
    wires: [['r', 'n1', 0], ['s', 'n2', 0], ['n1', 'n2', 1], ['n2', 'n1', 1], ['n1', 'q', 0], ['n2', 'qn', 0]],
  },
  '7-segment display (7 switches)': {
    nodes: [...[...'abcdefg'].map((c, i) => ['s' + i, 'INPUT', 30, 20 + 50 * i, c]), ['disp', 'SEG7', 260, 120]],
    wires: [0, 1, 2, 3, 4, 5, 6].map(i => ['s' + i, 'disp', i]),
  },
  'Hex → 7-segment decoder': {
    nodes: [...[0, 1, 2, 3].map(i => ['d' + i, 'INPUT', 30, 30 + i * 80, 'D' + i]), ['dec', 'BCD7', 200, 60], ['disp', 'SEG7', 420, 90]],
    wires: [0, 1, 2, 3].map(i => ['d' + i, 'dec', i]).concat([0, 1, 2, 3, 4, 5, 6].map(i => ['dec', 'disp', i, i])),
  },
  '2-bit counter (ripple, D flip-flops)': {
    nodes: [['clk', 'CLOCK', 30, 130], ['f1', 'DFF', 200, 60], ['f2', 'DFF', 200, 200],
            ['q0', 'OUTPUT', 380, 70, 'Q0'], ['q1', 'OUTPUT', 380, 210, 'Q1']],
    wires: [['clk', 'f1', 1], ['f1', 'f1', 0, 1], ['f1', 'f2', 1, 1], ['f2', 'f2', 0, 1], ['f1', 'q0', 0], ['f2', 'q1', 0]],
  },
  'Traffic light (T flip-flops)': {
    nodes: [['clk', 'CLOCK', 30, 130], ['hi', 'HIGH', 30, 40], ['t0', 'TFF', 190, 40], ['t1', 'TFF', 190, 200],
            ['nor', 'NOR', 360, 30], ['inv', 'NOT', 360, 150], ['and', 'AND', 480, 140],
            ['g', 'OUTPUT', 620, 45, 'GREEN'], ['y', 'OUTPUT', 620, 155, 'YELLOW'], ['r', 'OUTPUT', 620, 265, 'RED']],
    wires: [['clk', 't0', 1], ['clk', 't1', 1], ['hi', 't0', 0], ['t0', 't1', 0], ['t0', 'nor', 0], ['t1', 'nor', 1],
            ['t1', 'inv', 0], ['t0', 'and', 0], ['inv', 'and', 1], ['nor', 'g', 0], ['and', 'y', 0], ['t1', 'r', 0]],
  },
  'Ring counter (4 D flip-flops)': {
    nodes: [['clk', 'CLOCK', 30, 130, undefined, { hz: 2 }], ...[0, 1, 2, 3].flatMap(i => [
      ['f' + i, 'DFF', 160 + i * 140, 100], ['l' + i, 'OUTPUT', 175 + i * 140, 220, 'Q' + i]]),
      ['nor', 'NOR', 160, 310, undefined, { n: 3 }]],
    wires: [0, 1, 2, 3].flatMap(i => [['clk', 'f' + i, 1], ['f' + i, 'l' + i, 0]])
      .concat([1, 2, 3].map(i => ['f' + (i - 1), 'f' + i, 0]), [0, 1, 2].map(i => ['f' + i, 'nor', i]), [['nor', 'f0', 0]]),
  },
  '4-bit ALU with number display': {
    nodes: [['a', 'BUSIN', 30, 20, undefined, { num: 9 }], ['b', 'BUSIN', 30, 170, undefined, { num: 5 }], ['s0', 'INPUT', 30, 320, 'S0'], ['s1', 'INPUT', 30, 380, 'S1'],
            ['alu', 'ALU4', 230, 60], ['r', 'BUSOUT', 440, 60], ['c', 'OUTPUT', 440, 210, 'C'], ['z', 'OUTPUT', 440, 270, 'Z']],
    wires: [0, 1, 2, 3].flatMap(i => [['a', 'alu', i, i], ['b', 'alu', 4 + i, i], ['alu', 'r', i, i]])
      .concat([['s0', 'alu', 8], ['s1', 'alu', 9], ['alu', 'c', 0, 4], ['alu', 'z', 0, 5]]),
    hint: 'Click a number input to count it up (or double-click to type a value). S1 S0 picks add / subtract / AND / OR.',
  },
  'Counter with number display': {
    nodes: [['clk', 'CLOCK', 30, 60, undefined, { hz: 2 }], ['rst', 'INPUT', 30, 160, 'RST'], ['c', 'COUNTER4', 200, 40], ['n', 'BUSOUT', 400, 40]],
    wires: [['clk', 'c', 0], ['rst', 'c', 1], ...[0, 1, 2, 3].map(i => ['c', 'n', i, i])],
  },
  'Shift register with LEDs': {
    nodes: [['d', 'INPUT', 30, 40, 'D'], ['clk', 'CLOCK', 30, 140, undefined, { hz: 1 }], ['s', 'SHIFT4', 200, 40], ...[0, 1, 2, 3].map(i => ['q' + i, 'OUTPUT', 400, 30 + i * 55, 'Q' + i])],
    wires: [['d', 's', 0], ['clk', 's', 1], ...[0, 1, 2, 3].map(i => ['s', 'q' + i, 0, i])],
    hint: 'Set D, then watch the value march from Q0 to Q3 on each clock tick.',
  },
  'D latch vs D flip-flop': {
    nodes: [['d', 'INPUT', 30, 40, 'D'], ['clk', 'CLOCK', 30, 160, undefined, { hz: 0.5 }], ['l', 'DLATCH', 220, 30], ['f', 'DFF', 220, 170],
            ['ql', 'OUTPUT', 400, 40, 'LATCH'], ['qf', 'OUTPUT', 400, 180, 'FLOP']],
    wires: [['d', 'l', 0], ['clk', 'l', 1], ['d', 'f', 0], ['clk', 'f', 1], ['l', 'ql', 0], ['f', 'qf', 0]],
    timing: true,
    hint: 'Flip D while the clock is high: the latch follows immediately, the flip-flop only samples D on the rising edge.',
  },
  'Static hazard (glitch demo)': {
    nodes: [['a', 'INPUT', 30, 20, 'A', { value: true }], ['b', 'INPUT', 30, 110, 'B', { value: true }], ['c', 'INPUT', 30, 200, 'C', { value: true }],
            ['n', 'NOT', 150, 10, undefined, { delay: 3 }], ['x', 'AND', 290, 40], ['z', 'AND', 290, 150], ['o', 'OR', 430, 90], ['y', 'OUTPUT', 560, 105, 'Y']],
    wires: [['a', 'n', 0], ['a', 'x', 0], ['b', 'x', 1], ['n', 'z', 0], ['c', 'z', 1], ['x', 'o', 0], ['z', 'o', 1], ['o', 'y', 0]],
    speed: 'slow', timing: true,
    hint: 'Y = A·B + A̅·C should stay 1 when A flips. In Slow-mo, click A and watch Y glitch to 0 because the NOT gate has a delay of 3.',
  },
};

function setSpeedMode(mode) { internalSpeed = true; $('#speed').value = mode; $('#speed').dispatchEvent(new Event('change')); }
function restoreSpeed() {
  if (speedRestore === null) return;
  const m = speedRestore;
  speedRestore = null;
  if (speedMode !== m) setSpeedMode(m);
}

function loadExample(name) {
  const raw = EXAMPLES[name], spec = typeof raw === 'function' ? raw() : raw;
  restoreSpeed();
  record();
  $('#examples').value = name;   // keep the dropdown showing what is loaded (until the circuit is edited)
  activeChallenge = null;
  state = specToState(spec); sim = newSim(); selectOnly(null);
  fitView();
  if (spec.speed && speedMode !== spec.speed) { speedRestore = speedMode; setSpeedMode(spec.speed); }
  if (spec.timing && !timing.visible) { showTiming(true); $('#btn-timing').classList.add('on'); }
  changed();
  if (spec.hint) toast(spec.hint);
}

// Install an arbitrary spec (used by lessons): same as an example but without touching the dropdown.
function loadSpec(spec) {
  restoreSpeed();
  record();
  $('#examples').value = '';
  activeChallenge = null;
  state = specToState(spec); sim = newSim(); selectOnly(null);
  fitView();
  changed();
}

// Scale (never above 100%) and position the view so the whole circuit is visible.
function fitView(maxK = 1) {
  if (!state.nodes.length) { view = { x: 0, y: 0, k: 1 }; return; }
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const n of state.nodes) {
    const g = geom(n);
    b.x0 = Math.min(b.x0, n.x); b.y0 = Math.min(b.y0, n.y - 16); b.x1 = Math.max(b.x1, n.x + g.w); b.y1 = Math.max(b.y1, n.y + g.h);
  }
  const W = svg.clientWidth || 900, H = svg.clientHeight || 500, pad = 30;
  const k = Math.max(0.3, Math.min(maxK, (W - 2 * pad) / (b.x1 - b.x0), (H - 2 * pad) / (b.y1 - b.y0)));
  view = { k, x: pad - b.x0 * k, y: pad - b.y0 * k };
}

function loadChallenge(c) {
  restoreSpeed();
  record();
  $('#examples').value = '';
  state = challengeScaffold(c); sim = newSim(); selectOnly(null);
  activeChallenge = c; challengeMsg = null; hintShown = false;
  view = { x: 0, y: 0, k: 1 };
  changed();
}

// ---------------------------------------------------------------- guided demo
// Works on whatever is on the canvas: steps the switches through every combination (Gray code, so
// exactly one switch flips per step) and narrates which switch changed and which gates are outputting 1.
const DEMO_MAX_INPUTS = 6;
let demoTimer = null, demoSaved = null;

function stopDemo() {
  if (demoTimer == null) return;
  clearInterval(demoTimer);
  demoTimer = null;
  $('#caption').style.display = 'none';
  $('#demo').textContent = '▶ Demo';
  $('#demo').classList.remove('running');
  if (demoSaved) {                       // put the switches back where the user left them
    demoSaved.forEach(([n, v]) => { n.value = v; });
    demoSaved = null;
    changed();
  }
}

function startDemo() {
  if (!state.nodes.length) loadExample('Full adder');   // nothing to demo yet: use a sample
  const ins = state.nodes.filter(n => n.type === 'INPUT').slice(0, DEMO_MAX_INPUTS);
  const cap = $('#caption');
  if (!ins.length) {
    cap.innerHTML = 'Add at least one <b>Switch</b> and wire it up, then press Demo again.';
    cap.style.display = 'block';
    setTimeout(() => { if (demoTimer == null) cap.style.display = 'none'; }, 3500);
    return;
  }
  const outsNodes = state.nodes.filter(n => n.type === 'OUTPUT');
  const n = ins.length, total = 1 << n;
  demoSaved = ins.map(x => [x, x.value]);
  let i = 0, prev = null;
  const results = sweep(ins, () => outsNodes.map(o => val(o.id)));   // every row's outputs, in binary order
  const visited = new Set();

  // Truth table for the demo: the current row is highlighted and rows fill in as the demo reaches them.
  const demoTable = row => {
    const head = `<tr>${ins.map(x => `<th>${esc(x.label)}</th>`).join('')}${outsNodes.map(o => `<th>${esc(o.label)}</th>`).join('')}</tr>`;
    const body = combos(n).map((c, r) => `<tr class="${r === row ? 'cur' : ''}">${c.map(bit).join('')}${results[r].map(v => visited.has(r) ? bit(v) : '<td class="q">?</td>').join('')}</tr>`).join('');
    return `<div class="demo-table"><table>${head}${body}</table></div>`;
  };

  const step = () => {
    const gray = i ^ (i >> 1);
    const bits = ins.map((_, j) => (gray >> (n - 1 - j)) & 1);
    ins.forEach((x, j) => { x.value = !!bits[j]; });
    changed(true);

    const flipped = prev ? ins.map((x, j) => prev[j] !== bits[j] ? `<b>${esc(x.label)}</b> ${prev[j]}→${bits[j]}` : null).filter(Boolean) : [];
    const active = {};
    state.nodes.filter(x => (isGate(x.type) || isChip(x.type)) && val(x.id)).forEach(x => { active[x.type] = (active[x.type] || 0) + 1; });
    const gateText = Object.entries(active).map(([t, c]) => c > 1 ? `${t}×${c}` : t).join(', ') || 'none';
    const row = bits.reduce((a, b) => a * 2 + b, 0);
    visited.add(row);
    const inText = ins.map((x, j) => `${esc(x.label)}=${bits[j]}`).join(' ');
    const outText = outsNodes.map(o => `${esc(o.label)}=${val(o.id) ? 1 : 0}`).join(' ') || '(no LEDs)';

    cap.innerHTML = `<small>Step ${i + 1} of ${total}</small><br>` +
      `<b>${inText}</b> → <b>${outText}</b>${pending ? ' <small>(settling…)</small>' : ''}<br>` +
      `${flipped.length ? 'Flipped ' + flipped.join(', ') + '. ' : 'Starting state. '}Parts outputting 1: ${gateText}.` +
      (stable ? '' : '<br><span class="bad">Unstable: a feedback loop is oscillating.</span>') +
      (outsNodes.length ? demoTable(row) : '') +
      '<small>Moving dashes show wires carrying a 1. Click anywhere to stop.</small>';
    const cur = cap.querySelector('tr.cur'), box = cap.querySelector('.demo-table');
    if (cur && box) box.scrollTop = cur.offsetTop - box.clientHeight / 2;   // keep the current row in view
    prev = bits;
    i = (i + 1) % total;
  };

  cap.style.display = 'block';
  $('#demo').textContent = '■ Stop';
  $('#demo').classList.add('running');
  demoTimer = setInterval(() => { if (!paused) step(); }, speedMode === 'off' ? 2000 : 4000);
  step();
}
$('#demo').addEventListener('click', () => (demoTimer == null ? startDemo() : stopDemo()));
$('#flow').addEventListener('change', e => document.body.classList.toggle('noflow', !e.target.checked));

// ---------------------------------------------------------------- export / import / share
const readView = v => (v && [v.x, v.y, v.k].every(Number.isFinite) && v.k >= 0.3 && v.k <= 3) ? { x: v.x, y: v.y, k: v.k } : { x: 0, y: 0, k: 1 };

function adopt(circuit, rawView) {
  restoreSpeed();
  record();
  state = circuit; sim = newSim(); selectOnly(null);
  activeChallenge = null;
  if (rawView) view = readView(rawView); else fitView();
  buildPalette();
  changed();
}

$('#export').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(exportPayload(view), null, 2)], { type: 'application/json' }));
  a.download = 'circuit.json';
  a.click();
  URL.revokeObjectURL(a.href);
});
$('#import').addEventListener('click', () => $('#file').click());
$('#file').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  let circuit = null, raw = null;
  try { raw = JSON.parse(await f.text()); circuit = importPayload(raw); } catch { /* fall through */ }
  if (!circuit) { alert(importError || 'Not a valid Logic Lab circuit file.'); return; }
  adopt(circuit, raw.view);
});

const toB64 = bytes => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64 = str => Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
async function pipeBytes(bytes, transform, limit = 5e6) {          // size-capped so a hostile link cannot inflate to gigabytes
  const reader = new Blob([bytes]).stream().pipeThrough(transform).getReader(), chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) { reader.cancel(); throw new Error('payload too large'); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
async function encodeShare(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  return window.CompressionStream ? 'z.' + toB64(await pipeBytes(bytes, new CompressionStream('deflate-raw'))) : 'p.' + toB64(bytes);
}
async function decodeShare(s) {
  if (s.length > 200000) throw new Error('link too long');
  let bytes = fromB64(s.slice(2));
  if (s.startsWith('z.')) bytes = await pipeBytes(bytes, new DecompressionStream('deflate-raw'));
  else if (!s.startsWith('p.')) throw new Error('unknown link format');
  return JSON.parse(new TextDecoder().decode(bytes));
}

$('#share').addEventListener('click', async () => {
  const url = location.href.split('#')[0] + '#c=' + await encodeShare(exportPayload(view));
  try { await navigator.clipboard.writeText(url); toast('Link copied to clipboard'); }
  catch { prompt('Copy this link:', url); }
  if (url.length > 8000) toast('Long link: very large circuits may not paste into some apps. Use Export instead.');
});

// ---------------------------------------------------------------- dialogs
document.querySelectorAll('dialog .close').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));

function openChallenges() {
  const done = doneSet();
  $('#chal-list').innerHTML = CHALLENGES.map((c, i) => `<button class="chal" data-i="${i}"><div><div class="t">${esc(c.title)} <span class="tag">${c.level}</span></div><div class="d">${c.learn}</div></div>${done.has(c.id) ? '<span class="check">✓</span>' : ''}</button>`).join('');
  $('#dlg-challenges').showModal();
}
$('#btn-challenges').addEventListener('click', openChallenges);
$('#chal-list').addEventListener('click', e => {
  const b = e.target.closest('.chal');
  if (!b) return;
  $('#dlg-challenges').close();
  loadChallenge(CHALLENGES[+b.dataset.i]);
});

function renderExprAnalysis() {
  const { rows, inputs, tooMany } = circuitExpressions();
  const el = $('#expr-analysis');
  if (!rows.length) { el.innerHTML = '<p class="hint">Add LEDs to your circuit to see their expressions.</p>'; return; }
  el.innerHTML = rows.map((r, i) => r.built === null
    ? `<div class="expr-row"><b>${esc(r.label)}</b> <span class="hint">can't be written as a plain expression: it uses a clock, memory, a chip, a block or a feedback loop.</span></div>`
    : `<div class="expr-row"><b>${esc(r.label)}</b> as built:<code>${esc(r.built)}</code>${r.minimized !== null
        ? `minimal sum-of-products (Quine–McCluskey):<code>${esc(r.minimized)}</code><button data-i="${i}">Use minimal in editor</button>${r.values && r.vars && r.vars.length >= 2 && r.vars.length <= 4 ? `<div class="hint">Karnaugh map (outlined groups are the prime implicants):</div>${kmapHtml(r.vars, r.values, r.implicants)}` : ''}`
        : `<span class="hint">${tooMany ? `Too many switches (${inputs}) to minimize.` : ''}</span>`}</div>`).join('');
  el.querySelectorAll('button[data-i]').forEach(b => b.addEventListener('click', () => {
    const r = rows[+b.dataset.i];
    $('#expr-text').value = `${r.label} = ${r.minimized}`;
  }));
}
function loadExprFromCircuit() {
  const { rows } = circuitExpressions();
  const lines = rows.filter(r => r.built !== null).map(r => `${r.label} = ${r.built}`);
  if (lines.length) $('#expr-text').value = lines.join('\n');
  renderExprAnalysis();
}
$('#btn-expr').addEventListener('click', () => {
  $('#expr-err').textContent = '';
  if (!$('#expr-text').value.trim()) loadExprFromCircuit(); else renderExprAnalysis();
  $('#dlg-expr').showModal();
});
$('#expr-load').addEventListener('click', () => { $('#expr-err').textContent = ''; loadExprFromCircuit(); });
$('#expr-build').addEventListener('click', () => {
  let built;
  try { built = buildCircuit(parseProgram($('#expr-text').value)); }
  catch (err) { $('#expr-err').textContent = err.message; return; }
  $('#dlg-expr').close();
  adopt(built, null);
});

// ---------------------------------------------------------------- header controls
buildPalette();
for (const name of Object.keys(EXAMPLES)) $('#examples').add(new Option(name, name));
$('#examples').addEventListener('change', e => { if (e.target.value) loadExample(e.target.value); });
$('#clear').addEventListener('click', () => {
  restoreSpeed();
  const had = state.nodes.length > 0;
  record(); state = fresh(); sim = newSim(); activeChallenge = null; selectOnly(null); changed();
  if (had) toast('Circuit cleared. Press Ctrl+Z (or ↶) to undo.');
});
$('#toggle-palette').addEventListener('click', () => { const on = !document.body.classList.contains('show-palette'); closeDrawers(); document.body.classList.toggle('show-palette', on); });
$('#toggle-info').addEventListener('click', () => { const on = !document.body.classList.contains('show-info'); closeDrawers(); document.body.classList.toggle('show-info', on); });
$('#btn-tour').addEventListener('click', startTour);
$('#toggle-more').addEventListener('click', e => {
  const on = document.body.classList.toggle('show-more');
  e.currentTarget.setAttribute('aria-expanded', on);
});

// drawers start just below the header, whatever height it wraps to
const syncHeaderHeight = () => document.documentElement.style.setProperty('--header-h', document.querySelector('header').offsetHeight + 'px');
new ResizeObserver(syncHeaderHeight).observe(document.querySelector('header'));
syncHeaderHeight();

// last-resort safety net: tell the user, keep the autosave intact
let lastCrashToast = 0;
const crashed = () => { if (Date.now() - lastCrashToast > 10000) { lastCrashToast = Date.now(); toast('Something went wrong. Your circuit is autosaved; reload the page if it misbehaves.'); } };
window.addEventListener('error', crashed);
window.addEventListener('unhandledrejection', crashed);
$('#undo').addEventListener('click', undo);
$('#redo').addEventListener('click', redo);
const center = () => ({ x: svg.clientWidth / 2, y: svg.clientHeight / 2 });
$('#zin').addEventListener('click', () => zoomAt(center().x, center().y, 1.2));
$('#zout').addEventListener('click', () => zoomAt(center().x, center().y, 1 / 1.2));
$('#zoom-label').addEventListener('click', () => { view = { x: 0, y: 0, k: 1 }; render(); save(); });

$('#select-mode').addEventListener('click', e => { selectMode = !selectMode; e.currentTarget.classList.toggle('on', selectMode); });
$('#save-block').addEventListener('click', () => {
  const ids = selIds();
  if (!ids.length) return toast('Select the parts first (⬚ Select, then drag a box). Include the Switches (inputs) and LEDs (outputs).');
  const name = prompt('Name for this block (letters, digits, spaces):');
  if (name === null) return;
  const r = saveBlock(name, ids);
  if (r.error) return toast(r.error);
  buildPalette(); infoType = 'BLOCK:' + name.trim(); renderGateInfo();
  toast(`Saved block "${name.trim()}". Find it under My blocks.`);
});

$('#speed').addEventListener('change', e => {
  if (!internalSpeed) speedRestore = null;      // the user chose a speed themselves: keep it
  internalSpeed = false;
  speedMode = e.target.value;
  $('#step').hidden = speedMode !== 'manual';
  if (speedMode === 'off') changed(); else stopSlow();
  renderStatus();
});
$('#step').addEventListener('click', () => { pending = true; slowStep(); });

$('#btn-timing').addEventListener('click', e => { showTiming(!timing.visible); e.currentTarget.classList.toggle('on', timing.visible); });
$('#timing-close').addEventListener('click', () => { showTiming(false); $('#btn-timing').classList.remove('on'); });
$('#timing-clear').addEventListener('click', () => { timing.hist = []; sampleSignals(); drawTiming(); });

function applyTheme(light) {
  document.body.classList.toggle('light', light);
  try { localStorage.setItem(THEME_KEY, light ? 'light' : 'dark'); } catch { /* ignore */ }
  drawTiming();
}
$('#theme').addEventListener('click', () => applyTheme(!document.body.classList.contains('light')));

// clocks tick every 50 ms; each flips after half a period
setInterval(() => {
  if (drag || temp || paused) return;
  let flipped = false;
  for (const n of state.nodes) {
    if (n.type !== 'CLOCK') continue;
    const t = (clockPhase.get(n.id) || 0) + 50;
    if (t >= 500 / (n.hz || 1)) { clockPhase.set(n.id, 0); n.value = !n.value; flipped = true; } else clockPhase.set(n.id, t);
  }
  if (flipped) changed(true);
}, 50);

// ---------------------------------------------------------------- boot
async function boot() {
  try { applyTheme(localStorage.getItem(THEME_KEY) === 'light'); } catch { /* default dark */ }
  loadBlocks();
  buildPalette();
  let loaded = false;

  if (location.hash.startsWith('#ch=')) {
    try {
      const c = makeCustomChallenge(await decodeShare(location.hash.slice(4)));
      if (c) { loadChallenge(c); loaded = true; toast('Challenge loaded. Build a circuit that matches the target, then press Check.'); }
      else toast('That challenge link is not valid.');
    } catch { toast('That challenge link could not be read.'); }
  }
  if (location.hash.startsWith('#c=')) {
    try {
      const raw = await decodeShare(location.hash.slice(3)), circuit = importPayload(raw);
      if (circuit) { state = circuit; view = readView(raw.view); loaded = true; buildPalette(); changed(); toast('Loaded shared circuit'); }
      else toast(importError || 'That share link is not a valid circuit.');
    } catch { toast('That share link could not be read.'); }
  }
  let firstRun = false;
  if (!loaded) {
    let raw = null;
    try { raw = localStorage.getItem(STORE_KEY); } catch { /* storage blocked */ }
    if (raw) {
      let saved = null, circuit = null;
      importError = '';
      try { saved = JSON.parse(raw); circuit = importPayload(saved); } catch { /* handled below */ }
      if (circuit && circuit.nodes.length) {
        state = circuit; view = readView(saved.view);
        activeChallenge = CHALLENGES.find(c => c.id === saved.challenge) || null;
        loaded = true; changed();
      } else if (!circuit) {                                        // unreadable save: keep a copy instead of overwriting it
        try { localStorage.setItem(BACKUP_KEY, raw); } catch { /* ignore */ }
        toast(importError || 'Your last circuit could not be read. A backup was kept and an example was loaded.');
      }
    } else firstRun = true;
  }
  if (!loaded) loadExample('Half adder (XOR + AND)');
  undoStack = []; redoStack = []; renderStatus();
  if (firstRun) maybeStartTour();
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
}
// boot() is started by tools.js, once every UI module has been wired up
