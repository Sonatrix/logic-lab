'use strict';
// Guided challenges: build a circuit that matches a target truth table. No DOM access.

const maj = (a, b, c) => (a + b + c) >= 2;
const num = (...bits) => bits.reduce((a, b) => a * 2 + (b ? 1 : 0), 0);

const CHALLENGES = [
  { id: 'not', level: 'Beginner', title: 'Invert it', ins: ['A'], outs: ['Y'],
    learn: 'Every signal can be flipped. Wire the switch to the LED through a gate so Y is always the opposite of A.',
    hint: 'Use a NOT gate.', fn: ([a]) => [!a] },
  { id: 'xnor', level: 'Beginner', title: 'Both or neither', ins: ['A', 'B'], outs: ['Y'],
    learn: 'Y should light when A and B match (both 0 or both 1). This is an "equality" detector.',
    hint: 'There is a single gate that does exactly this.', fn: ([a, b]) => [a === b] },
  { id: 'xor-basic', level: 'Intermediate', title: 'XOR from scratch', ins: ['A', 'B'], outs: ['Y'], allowed: ['AND', 'OR', 'NOT'],
    learn: 'Build Y = A ⊕ B using only AND, OR and NOT gates. XOR means "one or the other but not both".',
    hint: '(A AND NOT B) OR (NOT A AND B)', fn: ([a, b]) => [a !== b] },
  { id: 'nand-and', level: 'Intermediate', title: 'AND from NANDs', ins: ['A', 'B'], outs: ['Y'], allowed: ['NAND'],
    learn: 'NAND is a universal gate. Build AND using only NAND gates.',
    hint: 'NAND gives NOT(A·B). What undoes a NOT? A NAND with both inputs tied together is a NOT.', fn: ([a, b]) => [a && b] },
  { id: 'nor-or', level: 'Intermediate', title: 'OR from NORs', ins: ['A', 'B'], outs: ['Y'], allowed: ['NOR'],
    learn: 'NOR is universal too. Build OR using only NOR gates.',
    hint: 'OR = NOT(NOR). Tie both inputs of a second NOR together to make a NOT.', fn: ([a, b]) => [a || b] },
  { id: 'majority', level: 'Intermediate', title: 'Majority vote', ins: ['A', 'B', 'C'], outs: ['Y'],
    learn: 'Y is 1 when at least two of the three inputs are 1, like a committee vote.',
    hint: '(A·B) + (B·C) + (A·C)', fn: ([a, b, c]) => [maj(+a, +b, +c)] },
  { id: 'mux', level: 'Intermediate', title: '2-to-1 multiplexer', ins: ['A', 'B', 'S'], outs: ['Y'],
    learn: 'A selector switch: Y copies A when S = 0, and copies B when S = 1.',
    hint: '(A AND NOT S) OR (B AND S)', fn: ([a, b, s]) => [s ? b : a] },
  { id: 'half-adder', level: 'Intermediate', title: 'Half adder', ins: ['A', 'B'], outs: ['SUM', 'CARRY'],
    learn: 'Add two one-bit numbers. SUM is the low bit of the result and CARRY is the high bit.',
    hint: 'SUM = A XOR B, CARRY = A AND B', fn: ([a, b]) => [a !== b, a && b] },
  { id: 'decoder', level: 'Intermediate', title: '2-to-4 decoder', ins: ['A1', 'A0'], outs: ['Y0', 'Y1', 'Y2', 'Y3'],
    learn: 'Read A1A0 as a binary number (0–3) and light exactly the matching output.',
    hint: 'Each output is an AND of A1 and A0, each possibly inverted. Y0 = NOT A1 AND NOT A0.',
    fn: ([a1, a0]) => [0, 1, 2, 3].map(k => k === num(a1, a0))},
  { id: 'full-adder', level: 'Advanced', title: 'Full adder', ins: ['A', 'B', 'CIN'], outs: ['SUM', 'COUT'],
    learn: 'Add three bits (A, B and a carry-in). It is two half adders plus an OR.',
    hint: 'SUM = A⊕B⊕CIN, COUT = (A·B) + (CIN·(A⊕B))', fn: ([a, b, c]) => [(+a + +b + +c) % 2 === 1, +a + +b + +c >= 2] },
  { id: 'parity', level: 'Advanced', title: 'Odd parity detector', ins: ['A', 'B', 'C', 'D'], outs: ['ODD'],
    learn: 'ODD lights when an odd number of the four inputs are 1. Parity bits like this catch single-bit errors.',
    hint: 'XOR is "odd parity". Chain them, or use one 4-input XOR.', fn: v => [v.filter(Boolean).length % 2 === 1] },
  { id: 'compare', level: 'Advanced', title: '2-bit comparator', ins: ['A1', 'A0', 'B1', 'B0'], outs: ['GT'],
    learn: 'GT lights when the 2-bit number A1A0 is greater than B1B0.',
    hint: 'A is greater if A1 > B1, or the high bits are equal and A0 > B0.',
    fn: ([a1, a0, b1, b0]) => [num(a1, a0) > num(b1, b0)] },

  // ---- sequential challenges: the checker applies steps (set switches, then pulse CLK) from a power-on state
  { id: 'sr-latch', level: 'Sequential', title: 'Build a latch', ins: ['S', 'R'], outs: ['Q'],
    learn: 'A latch remembers. <b>S</b> sets Q to 1, <b>R</b> resets it to 0, and with both at 0 Q must <b>hold</b> its last value.',
    hint: 'Cross-couple two NOR gates: Q = NOR(R, Q̄) and Q̄ = NOR(S, Q).',
    seq: [{ set: { S: 1, R: 0 }, expect: { Q: 1 } }, { set: { S: 0, R: 0 }, expect: { Q: 1 } }, { set: { S: 0, R: 1 }, expect: { Q: 0 } },
          { set: { S: 0, R: 0 }, expect: { Q: 0 } }, { set: { S: 1, R: 0 }, expect: { Q: 1 } }, { set: { S: 0, R: 0 }, expect: { Q: 1 } }] },
  { id: 'toggle', level: 'Sequential', title: 'Toggle on every clock', ins: ['CLK'], outs: ['Q'],
    learn: 'Q must flip each time the clock switch CLK is pulsed (0→1→0). The checker pulses it for you.',
    hint: 'A D flip-flop remembers D at each rising edge. Feed its Q̄ output back into D.',
    seq: [{ pulse: 'CLK', expect: { Q: 1 } }, { pulse: 'CLK', expect: { Q: 0 } }, { pulse: 'CLK', expect: { Q: 1 } }, { pulse: 'CLK', expect: { Q: 0 } }] },
  { id: 'count2', level: 'Sequential', title: '2-bit counter', ins: ['CLK'], outs: ['Q1', 'Q0'],
    learn: 'Count 00, 01, 10, 11, 00… one step per clock pulse.',
    hint: 'Two D flip-flops: D0 = NOT Q0, and D1 = Q1 XOR Q0.',
    seq: [{ pulse: 'CLK', expect: { Q1: 0, Q0: 1 } }, { pulse: 'CLK', expect: { Q1: 1, Q0: 0 } }, { pulse: 'CLK', expect: { Q1: 1, Q0: 1 } },
          { pulse: 'CLK', expect: { Q1: 0, Q0: 0 } }, { pulse: 'CLK', expect: { Q1: 0, Q0: 1 } }] },
  { id: 'detect101', level: 'Sequential', title: 'Detect the pattern 1-0-1', ins: ['X', 'CLK'], outs: ['HIT'],
    learn: 'Bits arrive on X, one per clock pulse. HIT must be 1 right after the pulse that stores the third bit of a 1,0,1 sequence.',
    hint: 'Shift the last three bits through flip-flops (or a shift register chip), then AND the right outputs, inverting the middle one.',
    seq: [{ set: { X: 1 }, pulse: 'CLK', expect: { HIT: 0 } }, { set: { X: 0 }, pulse: 'CLK', expect: { HIT: 0 } }, { set: { X: 1 }, pulse: 'CLK', expect: { HIT: 1 } },
          { set: { X: 1 }, pulse: 'CLK', expect: { HIT: 0 } }, { set: { X: 0 }, pulse: 'CLK', expect: { HIT: 0 } }, { set: { X: 1 }, pulse: 'CLK', expect: { HIT: 1 } }] },
];

let activeChallenge = null;
const DONE_KEY = 'logic-lab-done';
const doneSet = () => { try { return new Set(JSON.parse(localStorage.getItem(DONE_KEY)) || []); } catch { return new Set(); } };
const markDone = id => { const s = doneSet(); s.add(id); try { localStorage.setItem(DONE_KEY, JSON.stringify([...s])); } catch { /* ignore */ } };

// Lay out labelled switches on the left and LEDs on the right.
function challengeScaffold(c) {
  const s = fresh();
  const keep = state;
  state = s;
  try {
    c.ins.forEach((l, i) => addNode('INPUT', 70, 60 + i * 80, l));
    c.outs.forEach((l, i) => addNode('OUTPUT', 600, 60 + i * 80, l));
    s.counters = { INPUT: c.ins.length, OUTPUT: c.outs.length };
  } finally { state = keep; }
  return s;
}

const fmtBits = (labels, bits) => labels.map((l, i) => `${l}=${bits[i] ? 1 : 0}`).join(' ');

function checkChallenge(c) {
  const ins = c.ins.map(l => state.nodes.find(n => n.type === 'INPUT' && n.label === l));
  const outsN = c.outs.map(l => state.nodes.find(n => n.type === 'OUTPUT' && n.label === l));
  if (ins.includes(undefined) || outsN.includes(undefined)) {
    return { ok: false, msg: `Keep switches labelled ${c.ins.join(', ')} and LEDs labelled ${c.outs.join(', ')} on the canvas.` };
  }
  const parts = state.nodes.filter(n => !IO_TYPES.includes(n.type));
  if (c.allowed) {
    const bad = [...new Set(parts.filter(n => !c.allowed.includes(n.type)).map(n => n.type))];
    if (bad.length) return { ok: false, msg: `This challenge only allows ${c.allowed.join(', ')} gates. Remove: ${bad.join(', ')}.` };
  }
  if (c.seq) return runSequence(c, ins, outsN);
  const wrong = [];
  sweep(ins, bits => {
    const want = c.fn(bits), got = outsN.map(o => val(o.id));
    if (want.some((w, k) => !!w !== got[k])) wrong.push({ bits, want, got });
  });
  const total = 1 << ins.length;
  if (wrong.length) {
    const w = wrong[0];
    return { ok: false, msg: `${wrong.length} of ${total} input combinations are wrong. For example ${fmtBits(c.ins, w.bits)}: expected ${fmtBits(c.outs, w.want)}, got ${fmtBits(c.outs, w.got)}.` };
  }
  return { ok: true, msg: `Solved using ${parts.length} gate${parts.length === 1 ? '' : 's'}.` };
}

function challengeTable(c) {
  if (c.seq) {
    const pairs = o => Object.entries(o || {}).map(([k, v]) => `${esc(k)}=${v}`).join(' ');
    const rows = c.seq.map((st, i) => `<tr><td>${i + 1}</td><td>${pairs(st.set) || '·'}</td><td>${st.pulse ? '↑' : '·'}</td><td>${pairs(st.expect)}</td></tr>`).join('');
    return `<table><tr><th>#</th><th>Set</th><th>CLK</th><th>Expect</th></tr>${rows}</table>`;
  }
  return `<table><tr>${c.ins.map(l => `<th>${esc(l)}</th>`).join('')}${c.outs.map(l => `<th>${esc(l)}</th>`).join('')}</tr>` +
    combos(c.ins.length).map(bits => `<tr>${bits.map(b => `<td class="${b ? 'one' : ''}">${b ? 1 : 0}</td>`).join('')}${c.fn(bits).map(b => `<td class="${b ? 'one' : ''}">${b ? 1 : 0}</td>`).join('')}</tr>`).join('') + '</table>';
}

// ---------------------------------------------------------------- sequential checking
// Apply one step to the live circuit: set named switches, then optionally pulse a switch 0 -> 1 -> 0.
// `commit` re-evaluates (evalAll for checking, or the UI's change pipeline for demonstrations).
function applyStepOnce(step, commit) {
  const byLabel = l => state.nodes.find(n => n.type === 'INPUT' && n.label === l);
  for (const [l, v] of Object.entries(step.set || {})) { const n = byLabel(l); if (n) n.value = !!v; }
  commit();
  if (step.pulse) {
    const clk = byLabel(step.pulse);
    if (clk) { clk.value = true; commit(); clk.value = false; commit(); }
  }
}

function runSequence(c, ins, outsN) {
  const saved = { sim: structuredClone(sim), vals: ins.map(n => n.value), stable };
  let result = { ok: true, msg: '' };
  try {
    sim = newSim();
    ins.forEach(n => { n.value = false; });
    evalAll();
    for (let i = 0; i < c.seq.length && result.ok; i++) {
      const st = c.seq[i];
      applyStepOnce(st, evalAll);
      for (const [label, want] of Object.entries(st.expect || {})) {
        const o = outsN[c.outs.indexOf(label)], got = val(o.id);
        if (got !== !!want) {
          const did = [Object.keys(st.set || {}).length ? 'set ' + Object.entries(st.set).map(([k, v]) => `${k}=${v}`).join(' ') : '', st.pulse ? `pulsed ${st.pulse}` : ''].filter(Boolean).join(' and ');
          result = { ok: false, msg: `Step ${i + 1} of ${c.seq.length}: after ${did || 'power-on'}, ${label} should be ${want ? 1 : 0} but is ${got ? 1 : 0}.` };
          break;
        }
      }
    }
  } finally {
    ins.forEach((n, i) => { n.value = saved.vals[i]; });
    sim = saved.sim; stable = saved.stable;
  }
  if (result.ok) {
    const parts = state.nodes.filter(n => !IO_TYPES.includes(n.type)).length;
    result.msg = `Passed all ${c.seq.length} steps using ${parts} part${parts === 1 ? '' : 's'}.`;
  }
  return result;
}

// ---------------------------------------------------------------- challenges made by teachers
const LABEL_RE = /^[A-Za-z0-9_]{1,6}$/;

// Record the current circuit's behaviour as a combinational challenge (a plain, shareable object).
function captureChallenge({ title, desc, hint, allowed }) {
  const ins = state.nodes.filter(n => n.type === 'INPUT').sort((a, b) => a.y - b.y || a.x - b.x);
  const outs = state.nodes.filter(n => n.type === 'OUTPUT').sort((a, b) => a.y - b.y || a.x - b.x);
  if (!ins.length || !outs.length) return { error: 'The circuit needs at least one switch and one LED.' };
  if (ins.length > 5) return { error: 'Challenges support up to 5 switches.' };
  if (outs.length > 6) return { error: 'Challenges support up to 6 LEDs.' };
  const labels = [...ins, ...outs].map(n => n.label);
  if (new Set(labels).size !== labels.length || !labels.every(l => LABEL_RE.test(l))) return { error: 'Switch and LED labels must be unique, 1-6 letters, digits or underscores.' };
  if (state.nodes.some(n => ['CLOCK', 'BUTTON', 'BLOCK'].includes(n.type) || (isChip(n.type) && CHIPS[n.type].clocked))) return { error: 'Only combinational circuits (no clocks, buttons, blocks or flip-flops) can be turned into a challenge.' };
  const table = sweep(ins, () => outs.map(o => val(o.id) ? 1 : 0));
  return { t: String(title || 'Custom challenge').slice(0, 60), d: String(desc || '').slice(0, 400), h: String(hint || '').slice(0, 200),
    ins: ins.map(n => n.label), outs: outs.map(n => n.label), table, allowed: (allowed || []).filter(g => g in GATES) };
}

// Validate an untrusted challenge object (from a link) and turn it into a challenge; null when invalid.
function makeCustomChallenge(raw) {
  try {
    if (!raw || typeof raw !== 'object') return null;
    const { ins, outs, table } = raw;
    if (![ins, outs, table].every(Array.isArray) || ins.length < 1 || ins.length > 5 || outs.length < 1 || outs.length > 6) return null;
    const labels = [...ins, ...outs];
    if (new Set(labels).size !== labels.length || !labels.every(l => typeof l === 'string' && LABEL_RE.test(l))) return null;
    if (table.length !== 1 << ins.length || !table.every(r => Array.isArray(r) && r.length === outs.length && r.every(v => v === 0 || v === 1 || typeof v === 'boolean'))) return null;
    const allowed = Array.isArray(raw.allowed) ? raw.allowed.filter(g => typeof g === 'string' && g in GATES) : [];
    return {
      id: 'custom', level: 'Custom', title: String(raw.t || 'Custom challenge').slice(0, 60),
      learn: esc(String(raw.d || 'Build a circuit that matches the target truth table.').slice(0, 400)),
      hint: String(raw.h || 'No hint was provided.').slice(0, 200), ins: [...ins], outs: [...outs], allowed: allowed.length ? allowed : null,
      fn: bits => table[parseInt(bits.map(b => +b).join(''), 2)].map(v => !!v),
    };
  } catch { return null; }
}

// ---------------------------------------------------------------- progress (stored locally; can be exported as a file)
function progressPayload() {
  return { app: 'logic-lab', kind: 'progress', version: 1, challenges: [...doneSet()], lessons: [...lessonsDone()] };
}
// Merge an untrusted progress file; returns how many new items were added, or null if it is not a progress file.
function mergeProgress(raw) {
  if (!raw || raw.app !== 'logic-lab' || raw.kind !== 'progress') return null;
  const okC = new Set(CHALLENGES.map(c => c.id)), okL = new Set(LESSONS.map(l => l.id));
  let added = 0;
  for (const id of Array.isArray(raw.challenges) ? raw.challenges : []) if (okC.has(id) && !doneSet().has(id)) { markDone(id); added++; }
  for (const id of Array.isArray(raw.lessons) ? raw.lessons : []) if (okL.has(id) && !lessonsDone().has(id)) { markLessonDone(id); added++; }
  return added;
}
