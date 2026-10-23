'use strict';
// Part catalogue and geometry. No DOM access, so it can be tested under node.

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const letters = k => Array.from({ length: k }, (_, i) => String.fromCharCode(65 + i));
const MAX_INPUTS = 8;

// ---------------------------------------------------------------- gates
const GATES = {
  AND:    { ins: 2, multi: true, fn: v => v.every(Boolean),                    expr: n => n.join(' · '),         desc: 'Output is 1 only when <b>all</b> inputs are 1.' },
  OR:     { ins: 2, multi: true, fn: v => v.some(Boolean),                     expr: n => n.join(' + '),         desc: 'Output is 1 when <b>at least one</b> input is 1.' },
  NOT:    { ins: 1,              fn: v => !v[0],                               expr: () => '¬A',                 desc: 'Inverter: output is the opposite of the input.' },
  BUFFER: { ins: 1,              fn: v => !!v[0],                              expr: () => 'A',                  desc: 'Passes the input through unchanged (used to boost / delay signals).' },
  NAND:   { ins: 2, multi: true, fn: v => !v.every(Boolean),                   expr: n => `¬(${n.join(' · ')})`, desc: 'AND followed by NOT. Output is 0 only when all inputs are 1. A <i>universal</i> gate: any circuit can be built from NANDs alone.' },
  NOR:    { ins: 2, multi: true, fn: v => !v.some(Boolean),                    expr: n => `¬(${n.join(' + ')})`, desc: 'OR followed by NOT. Output is 1 only when all inputs are 0. Also a universal gate.' },
  XOR:    { ins: 2, multi: true, fn: v => v.filter(Boolean).length % 2 === 1,  expr: n => n.join(' ⊕ '),         desc: 'Exclusive OR: output is 1 when an <b>odd number</b> of inputs are 1 (with 2 inputs: when they differ). The sum bit of a half adder.' },
  XNOR:   { ins: 2, multi: true, fn: v => v.filter(Boolean).length % 2 === 0,  expr: n => `¬(${n.join(' ⊕ ')})`, desc: 'Inverted XOR: with 2 inputs, output is 1 when they are the <b>same</b>.' },
};
const INVERTED = new Set(['NOT', 'NAND', 'NOR', 'XNOR']);
const isGate = t => t in GATES;
const inCount = n => GATES[n.type].ins === 1 ? 1 : (n.n || GATES[n.type].ins);

// ---------------------------------------------------------------- sources, sinks
const IO_TYPES = ['INPUT', 'CLOCK', 'BUTTON', 'OUTPUT', 'HIGH', 'LOW', 'SEG7', 'BUSIN', 'BUSOUT', 'NOTE'];
const BUS_WIDTHS = [4, 8];
const MAX_DELAY = 5;
const CLOCK_RATES = [0.25, 0.5, 1, 2, 4];
// 7-segment layout: segment a..g as [x1, y1, x2, y2] inside the display node
const SEGMENTS = [[28, 18, 52, 18], [56, 22, 56, 56], [56, 64, 56, 98], [28, 102, 52, 102], [24, 64, 24, 98], [24, 22, 24, 56], [28, 60, 52, 60]];

// ---------------------------------------------------------------- multi-pin chips
// eval(inputs, mem) -> outputs. Clocked chips remember state in `mem` and react to the rising edge.
const rise = (clk, m) => { const r = clk && !m.clk; m.clk = clk; return r; };
const HEX_SEGS = ['abcdef', 'bc', 'abdeg', 'abcdg', 'bcfg', 'acdfg', 'acdefg', 'abc', 'abcdefg', 'abcdfg', 'abcefg', 'cdefg', 'adef', 'bcdeg', 'adefg', 'aefg'];
const CHIPS = {
  DFF:   { title: 'D flip-flop', clocked: true, ins: ['D', 'CLK'], outs: ['Q', 'Q̄'],
           desc: 'A 1-bit memory. It copies <b>D</b> to <b>Q</b> only at the moment the clock goes 0→1, and holds it otherwise. Q̄ is the inverse of Q. Wire Q̄ back to D and it divides the clock by 2.',
           eval: (i, m) => { if (rise(i[1], m)) m.q = !!i[0]; return [!!m.q, !m.q]; } },
  TFF:   { title: 'T flip-flop', clocked: true, ins: ['T', 'CLK'], outs: ['Q', 'Q̄'],
           desc: 'On each rising clock edge, if <b>T = 1</b> the output <b>toggles</b>; if T = 0 it holds. The building block of counters.',
           eval: (i, m) => { if (rise(i[1], m) && i[0]) m.q = !m.q; return [!!m.q, !m.q]; } },
  JKFF:  { title: 'JK flip-flop', clocked: true, ins: ['J', 'K', 'CLK'], outs: ['Q', 'Q̄'],
           desc: 'On a rising clock edge: J=1,K=0 sets Q to 1; J=0,K=1 resets Q to 0; J=K=1 toggles Q; J=K=0 holds.',
           eval: (i, m) => { if (rise(i[2], m)) { if (i[0] && i[1]) m.q = !m.q; else if (i[0]) m.q = true; else if (i[1]) m.q = false; } return [!!m.q, !m.q]; } },
  REG4:  { title: '4-bit register', clocked: true, ins: ['D0', 'D1', 'D2', 'D3', 'CLK'], outs: ['Q0', 'Q1', 'Q2', 'Q3'],
           desc: 'Four D flip-flops sharing one clock: on the rising edge all four data bits are stored at once.',
           eval: (i, m) => { if (!m.q) m.q = [false, false, false, false]; if (rise(i[4], m)) m.q = i.slice(0, 4).map(Boolean); return m.q.slice(); } },
  MUX2:  { title: '2:1 multiplexer', ins: ['D0', 'D1', 'S'], outs: ['Y'],
           desc: 'A data selector: Y = D0 when S = 0, and Y = D1 when S = 1.',
           eval: i => [i[2] ? i[1] : i[0]] },
  DEC24: { title: '2→4 decoder', ins: ['A0', 'A1'], outs: ['Y0', 'Y1', 'Y2', 'Y3'],
           desc: 'Reads A1A0 as a binary number and turns on exactly that one output line (one-hot).',
           eval: i => { const v = (i[0] ? 1 : 0) + (i[1] ? 2 : 0); return [0, 1, 2, 3].map(k => k === v); } },
  BCD7:  { title: 'Hex → 7-seg', ins: ['D0', 'D1', 'D2', 'D3'], outs: [...'abcdefg'],
           desc: 'Decodes a 4-bit number (D3 is the most significant bit) into the seven segment signals a–g for a 7-segment display.',
           eval: i => { const v = i.reduce((a, b, k) => a + (b ? 1 << k : 0), 0); return [...'abcdefg'].map(s => HEX_SEGS[v].includes(s)); } },
};
const bitsToNum = bits => bits.reduce((a, b, k) => a + (b ? 1 << k : 0), 0);       // bits[0] is the least significant
const numToBits = (v, k) => Array.from({ length: k }, (_, i) => !!((v >> i) & 1));
const pinNames = (p, k) => Array.from({ length: k }, (_, i) => p + i);

Object.assign(CHIPS, {
  DLATCH: { title: 'D latch', ins: ['D', 'EN'], outs: ['Q', 'Q̄'],
    desc: 'A transparent latch: while <b>EN = 1</b>, Q follows D; when EN drops to 0, Q <b>holds</b> the last value. Unlike a flip-flop it is level-triggered, not edge-triggered.',
    eval: (i, m) => { if (i[1]) m.q = !!i[0]; return [!!m.q, !m.q]; } },
  SHIFT4: { title: '4-bit shift reg', clocked: true, ins: ['D', 'CLK'], outs: pinNames('Q', 4),
    desc: 'On each rising clock edge every bit moves one place along (D → Q0 → Q1 → Q2 → Q3). A serial-in, parallel-out shift register.',
    eval: (i, m) => { if (!m.q) m.q = [false, false, false, false]; if (rise(i[1], m)) m.q = [!!i[0], ...m.q.slice(0, 3)]; return m.q.slice(); } },
  COUNTER4: { title: '4-bit counter', clocked: true, ins: ['CLK', 'RST'], outs: pinNames('Q', 4),
    desc: 'Counts 0–15 and wraps, one step per rising clock edge. <b>RST = 1</b> clears it to 0 immediately.',
    eval: (i, m) => { const r = rise(i[0], m); if (i[1]) m.n = 0; else if (r) m.n = ((m.n || 0) + 1) & 15; return numToBits(m.n || 0, 4); } },
  ADD4: { title: '4-bit adder', ins: [...pinNames('A', 4), ...pinNames('B', 4), 'CIN'], outs: [...pinNames('S', 4), 'COUT'],
    desc: 'Adds two 4-bit numbers A and B plus a carry-in: S is the 4-bit sum and COUT is the carry out (set when the result needs a fifth bit).',
    eval: i => { const t = bitsToNum(i.slice(0, 4)) + bitsToNum(i.slice(4, 8)) + (i[8] ? 1 : 0); return [...numToBits(t & 15, 4), t > 15]; } },
  ALU4: { title: '4-bit ALU', ins: [...pinNames('A', 4), ...pinNames('B', 4), 'S0', 'S1'], outs: [...pinNames('R', 4), 'C', 'Z'],
    desc: 'Arithmetic-logic unit. <b>S1 S0</b> selects the operation: 00 add, 01 subtract (A−B), 10 AND, 11 OR. <b>C</b> is carry (add) or no-borrow (subtract); <b>Z</b> is 1 when the result is 0.',
    eval: i => {
      const a = bitsToNum(i.slice(0, 4)), b = bitsToNum(i.slice(4, 8)), op = (i[8] ? 1 : 0) + (i[9] ? 2 : 0);
      const t = op === 0 ? a + b : op === 1 ? a - b : op === 2 ? a & b : a | b, r = t & 15;
      return [...numToBits(r, 4), op === 0 ? t > 15 : op === 1 ? a >= b : false, r === 0];
    } },
});
const isChip = t => t in CHIPS;

// ---------------------------------------------------------------- user-made blocks
// name -> { nodes, wires, ins:[nodeId], outs:[nodeId], insLabels, outsLabels }
const BLOCKS = new Map();

// ---------------------------------------------------------------- catalogue of everything placeable
const PARTS = new Set([...Object.keys(GATES), ...IO_TYPES, ...Object.keys(CHIPS), 'BLOCK']);

const PART_INFO = {
  INPUT:  ['Switch', 'A manual input. <b>Click</b> it to flip between 0 and 1. Double-click to rename.'],
  BUTTON: ['Push button', 'A momentary input: it is 1 only while you <b>hold</b> the mouse down on it.'],
  CLOCK:  ['Clock', 'An input that flips 0↔1 automatically, producing a regular pulse train. Pick its speed below.'],
  OUTPUT: ['LED', 'Shows the value on its input: lit green for 1. Double-click to rename.'],
  HIGH:   ['Constant 1', 'Always outputs 1. Use it to tie an unused input high.'],
  LOW:    ['Constant 0', 'Always outputs 0. Use it to tie an unused input low.'],
  SEG7:   ['7-segment display', 'Seven inputs a–g, one per segment. Wire a decoder (or your own gates) to it to show digits.'],
  BUSIN:  ['Number input', 'Sets a whole binary number at once: pins D0 (least significant) upward. <b>Click</b> to count up by 1, or <b>double-click</b> to type a value (decimal, or hex like 0xA). Choose 4 or 8 bits below.'],
  BUSOUT: ['Number display', 'Shows the binary number on pins D0 (least significant) upward, in hex and decimal.'],
  NOTE:   ['Note', 'A text label for the canvas. <b>Double-click</b> to edit it. It has no effect on the circuit.'],
};

// ---------------------------------------------------------------- geometry
const pinY = (h, k, i) => Math.round(h * (i + 1) / (k + 1));

function pinsOf(n) {
  if (n.type === 'BUSIN' || n.type === 'BUSOUT') {
    const k = n.bits === 8 ? 8 : 4, labels = pinNames('D', k);
    return n.type === 'BUSIN' ? { title: `${k}-bit input`, ins: [], outs: labels } : { title: `${k}-bit display`, ins: labels, outs: [] };
  }
  if (n.type === 'BLOCK') {
    const d = BLOCKS.get(n.block);
    return d ? { title: n.block, ins: d.insLabels, outs: d.outsLabels } : { title: '? ' + n.block, ins: [], outs: [] };
  }
  const c = CHIPS[n.type];
  return c ? { title: c.title, ins: c.ins, outs: c.outs } : null;
}

// width, height, input port y offsets (x = 0), output ports [x, y]
function geom(n) {
  switch (n.type) {
    case 'INPUT': case 'CLOCK': case 'BUTTON': {                 // widen to fit "LABEL = 1"
      const w = Math.max(60, Math.ceil((14 + 8.5 * ((n.label || 'A').length + 4)) / 10) * 10);
      return { w, h: 40, ins: [], outs: [[w, 20]] };
    }
    case 'OUTPUT': return { w: 50, h: 40, ins: [20], outs: [] };
    case 'HIGH': case 'LOW': return { w: 40, h: 30, ins: [], outs: [[40, 15]] };
    case 'SEG7': return { w: 70, h: 120, ins: SEGMENTS.map((_, i) => 15 + 15 * i), outs: [] };
    case 'NOTE': return { w: Math.max(80, Math.ceil(((n.text || 'Note').length * 7.2 + 24) / 10) * 10), h: 34, ins: [], outs: [] };
  }
  const p = pinsOf(n);
  if (p) {
    const w = n.type === 'BLOCK' ? 90 : 84, m = Math.max(p.ins.length, p.outs.length, 1), h = Math.max(60, 20 * (m + 1));
    return { w, h, ins: p.ins.map((_, i) => pinY(h, p.ins.length, i)), outs: p.outs.map((_, i) => [w, pinY(h, p.outs.length, i)]) };
  }
  const k = inCount(n), h = k === 1 ? 60 : Math.max(60, 20 * (k + 1));
  return { w: 76, h, ins: k === 1 ? [30] : Array.from({ length: k }, (_, i) => 20 * (i + 1)), outs: [[76, h / 2]] };
}

function pinName(n, kind, i) {
  const p = pinsOf(n);
  if (p) return (kind === 'in' ? p.ins : p.outs)[i] || '';
  if (n.type === 'SEG7') return 'abcdefg'[i];
  if (kind === 'out') return 'out';
  return isGate(n.type) && inCount(n) > 1 ? letters(8)[i] : 'in';
}
