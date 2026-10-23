'use strict';
// Headless tests for the DOM-free modules. Run: node test/logic.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const store = new Map();
const ctx = vm.createContext({ console, structuredClone, localStorage: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => store.set(k, String(v)) } });
for (const f of ['parts.js', 'model.js', 'expr.js', 'layout.js', 'netlist.js', 'fsm.js', 'challenges.js', 'lessons.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
}
const run = code => vm.runInContext('{' + code + '\n}', ctx);   // block scope: each snippet may declare its own consts

let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`); if (!ok) failed++; };

// helper: build a circuit from expression text and make it the live state
const load = text => run(`state = buildCircuit(parseProgram(${JSON.stringify(text)})); sim = newSim(); evalAll();`);
const table = () => run(`(() => { const ins = state.nodes.filter(n => n.type === 'INPUT'); const outs = state.nodes.filter(n => n.type === 'OUTPUT');
  return sweep(ins, c => c.map(Number).join('') + '>' + outs.map(o => +val(o.id)).join('')); })()`);

// ---- expressions build correct circuits
load('Y = A AND B');
check('AND', table().join() === '00>0,01>0,10>0,11>1', table());
load('Y = (A AND NOT B) OR (NOT A AND B)');
check('XOR from AND/OR/NOT', table().join() === '00>0,01>1,10>1,11>0', table());
load("SUM = A ^ B ^ C; COUT = A*B + C*(A ^ B)");
check('full adder expressions', table().join() === '000>00,001>10,010>10,011>01,100>10,101>01,110>01,111>11', table());
load('Y = A NAND B; Z = A XNOR B');
check('NAND/XNOR binary operators', table().join() === '00>11,01>10,10>10,11>01', table());
load("Y = A' + B'");
check("postfix ' negation", table().join() === '00>1,01>1,10>1,11>0', table());
load('X = A AND B\nY = X OR C');
check('named intermediate signals', table().join() === '000>00,001>01,010>00,011>01,100>00,101>01,110>11,111>11'.replace(/>(\d)(\d)/g, (m, a, b) => '>' + a + b), table());
load('Y = A AND B AND C AND D AND E AND F AND G AND H AND I AND J');
check('>8 inputs split into gates', run('state.nodes.every(n => !isGate(n.type) || inCount(n) <= MAX_INPUTS)') && table().length === 1024);

for (const bad of ['Y = A AND', 'Y = (A OR B', 'Y = A $ B', 'Y = ', 'Y = A; Y = B', '2Bad = A', 'Y = 2']) {
  let threw = false;
  try { run(`parseProgram(${JSON.stringify(bad)})`); } catch { threw = true; }
  check(`rejects "${bad}"`, threw);
}
let useBefore = false;
try { run(`buildCircuit(parseProgram("Y = X; X = A"))`); } catch { useBefore = true; }
check('use before define is an error', useBefore);

// ---- circuit -> expression + minimization
load('Y = (A AND B) OR (A AND NOT B) OR (NOT A AND B)');
let ex = run('circuitExpressions()').rows[0];
check('minimizes a+b form', /^(A OR B|B OR A)$/.test(ex.minimized), ex.minimized);
check('structural expression re-parses', run(`parseProgram("Y = " + ${JSON.stringify(ex.built)})`).length === 1);
load('Y = A XOR B');
ex = run('circuitExpressions()').rows[0];
check('xor minimized', ex.minimized.includes(' OR ') && ex.minimized.includes('NOT'), ex.minimized);

// ---- flip-flop edge semantics
run(`state = fresh(); sim = newSim();
  const clk = addNode('CLOCK', 40, 40); const hi = addNode('HIGH', 40, 120);
  const t0 = addNode('TFF', 200, 40), t1 = addNode('TFF', 200, 160);
  connect(clk.id, 0, t0.id, 1); connect(clk.id, 0, t1.id, 1); connect(hi.id, 0, t0.id, 0); connect(t0.id, 0, t1.id, 0);
  globalThis.__c = { clk, t0, t1 }; evalAll();`);
const seq = [];
for (let i = 0; i < 8; i++) {
  run('__c.clk.value = !__c.clk.value; evalAll();');
  if (i % 2 === 0) seq.push(run('+val(__c.t1.id) * 2 + +val(__c.t0.id)'));
}
check('synchronous T counter counts 1,2,3,0', seq.join() === '1,2,3,0', seq.join());

run(`state = fresh(); sim = newSim();
  const clk = addNode('CLOCK', 40, 40); const f = [0, 1, 2, 3].map(i => addNode('DFF', 200 + i * 130, 100));
  const nor = addNode('NOR', 100, 260, undefined, { n: 3 });
  f.forEach(x => connect(clk.id, 0, x.id, 1));
  [0, 1, 2].forEach(i => connect(f[i].id, 0, nor.id, i));
  connect(nor.id, 0, f[0].id, 0); [1, 2, 3].forEach(i => connect(f[i - 1].id, 0, f[i].id, 0));
  globalThis.__r = { clk, f }; evalAll();`);
const ring = [];
for (let i = 0; i < 10; i++) {
  run('__r.clk.value = !__r.clk.value; evalAll();');
  if (i % 2 === 0) ring.push(run('__r.f.map(x => +val(x.id)).join("")'));
}
check('ring counter walks a single 1 around', ring.join() === '1000,0100,0010,0001,1000', ring.join());

// ---- latch memory
run(`state = fresh(); sim = newSim();
  const r = addNode('INPUT', 40, 40, 'R'), s = addNode('INPUT', 40, 200, 'S');
  const n1 = addNode('NOR', 250, 50), n2 = addNode('NOR', 250, 190);
  connect(r.id, 0, n1.id, 0); connect(s.id, 0, n2.id, 0); connect(n1.id, 0, n2.id, 1); connect(n2.id, 0, n1.id, 1);
  globalThis.__l = { r, s, n1 }; evalAll();`);
const q = [];
const setRS = (r, s) => { run(`__l.r.value = ${r}; __l.s.value = ${s}; evalAll();`); q.push(run('+val(__l.n1.id)')); };
setRS(0, 1); setRS(0, 0); setRS(1, 0); setRS(0, 0);
check('SR latch sets, holds, resets, holds', q.join() === '1,1,0,0', q.join());

// ---- 7-seg decoder chip
run(`state = fresh(); sim = newSim(); const ins = [0,1,2,3].map(i => addNode('INPUT', 40, 40 + i * 60)); const d = addNode('BCD7', 200, 120);
  ins.forEach((n, i) => connect(n.id, 0, d.id, i)); ins[0].value = true; evalAll(); globalThis.__d = d;`);
check('hex decoder shows 1 as segments b,c', run('[0,1,2,3,4,5,6].map(i => +val(__d.id, i)).join("")') === '0110000');

// ---- blocks
run(`BLOCKS.clear(); state = buildCircuit(parseProgram("SUM = A ^ B; CARRY = A & B")); sim = newSim();`);
check('save block', run('saveBlock("Half Add", state.nodes.map(n => n.id))').ok === true);
check('duplicate block name rejected', !!run('saveBlock("Half Add", state.nodes.map(n => n.id))').error);
run(`state = fresh(); sim = newSim();
  const a = addNode('INPUT', 40, 40, 'A'), b = addNode('INPUT', 40, 140, 'B'); const blk = addNode('BLOCK', 200, 90, undefined, { block: 'Half Add' });
  const s = addNode('OUTPUT', 360, 60, 'S'), c = addNode('OUTPUT', 360, 140, 'C');
  connect(a.id, 0, blk.id, 0); connect(b.id, 0, blk.id, 1); connect(blk.id, 0, s.id, 0); connect(blk.id, 1, c.id, 0); evalAll();`);
check('block behaves like its contents', table().join() === '00>00,01>10,10>10,11>01', table());
check('cannot delete a block in use', !!run('deleteBlock("Half Add")').error);

// ---- import / export validation
const payload = run('JSON.parse(JSON.stringify(exportPayload({ x: 0, y: 0, k: 1 })))');
check('export bundles used blocks', payload.blocks.length === 1 && payload.blocks[0].name === 'Half Add');
run('BLOCKS.clear()');
check('import restores bundled block', run(`importPayload(${JSON.stringify(payload)})`) !== null && run('BLOCKS.has("Half Add")'));
check('import is rejected when invalid', run('importPayload({ nodes: [{ id: 1, type: "EVIL", x: 0, y: 0 }], wires: [] })') === null);
check('import rejects bad wire ports', run('importPayload({ nodes: [{ id: 1, type: "AND", x: 0, y: 0 }], wires: [{ from: 1, to: 1, port: 9 }] })') === null);
check('import rejects unknown block', run('importPayload({ nodes: [{ id: 1, type: "BLOCK", block: "nope", x: 0, y: 0 }], wires: [] })') === null);
check('labels are truncated', run('importPayload({ nodes: [{ id: 1, type: "INPUT", label: "<img src=x onerror=1>", x: 0, y: 0 }], wires: [] }).nodes[0].label.length') <= 6);

// ---- challenges: build a correct solution and a wrong one
const solve = (id, text) => {
  run(`const c = CHALLENGES.find(x => x.id === ${JSON.stringify(id)}); state = challengeScaffold(c); sim = newSim();
    const built = buildCircuit(parseProgram(${JSON.stringify(text)}));
    state = built; evalAll(); globalThis.__res = checkChallenge(c);`);
  return run('__res');
};
check('challenge: not', solve('not', 'Y = NOT A').ok);
check('challenge: wrong answer reported', !solve('not', 'Y = A').ok && /wrong/.test(run('__res.msg')));
check('challenge: xor with allowed gates', solve('xor-basic', 'Y = (A AND NOT B) OR (NOT A AND B)').ok);
check('challenge: xor with disallowed gate', !solve('xor-basic', 'Y = A XOR B').ok);
check('challenge: majority', solve('majority', 'Y = A*B + B*C + A*C').ok);
check('challenge: full adder', solve('full-adder', 'SUM = A ^ B ^ CIN; COUT = A*B + CIN*(A ^ B)').ok);
check('challenge: comparator', solve('compare', "GT = A1 AND NOT B1 OR (A1 XNOR B1) AND A0 AND NOT B0").ok);
check('challenge: decoder', solve('decoder', "Y0 = NOT A1 AND NOT A0; Y1 = NOT A1 AND A0; Y2 = A1 AND NOT A0; Y3 = A1 AND A0").ok);
check('every combinational challenge has a valid truth table', run('CHALLENGES.filter(c => c.fn).every(c => combos(c.ins.length).every(b => c.fn(b).length === c.outs.length))'));
check('every sequential challenge only refers to its own pins', run(`CHALLENGES.filter(c => c.seq).every(c => c.seq.every(s => [...Object.keys(s.set || {}), ...(s.pulse ? [s.pulse] : [])].every(k => c.ins.includes(k)) && Object.keys(s.expect || {}).every(k => c.outs.includes(k))))`));

// =====================================================================================================
// round 3: new chips, delays, k-maps, FSM, Verilog, layout, lessons, sequential + custom challenges
// =====================================================================================================
const pulse = (clkExpr) => run(`${clkExpr}.value = true; evalAll(); ${clkExpr}.value = false; evalAll();`);
const spec = (s, label = 'spec') => run(`state = specToState(${JSON.stringify(s)}); sim = newSim(); evalAll(); 1`);
const led = l => run(`+val(state.nodes.find(n => n.type === 'OUTPUT' && n.label === ${JSON.stringify(l)}).id)`);
const setIn = (l, v) => run(`state.nodes.find(n => n.type === 'INPUT' && n.label === ${JSON.stringify(l)}).value = ${!!v}; evalAll(); 1`);
const pulseIn = l => run(`(() => { const n = state.nodes.find(n => n.type === 'INPUT' && n.label === ${JSON.stringify(l)}); n.value = true; evalAll(); n.value = false; evalAll(); })()`);

// ---- chips
spec({ nodes: [['clk', 'INPUT', 0, 0, 'CLK'], ['r', 'INPUT', 0, 80, 'RST'], ['c', 'COUNTER4', 150, 0], ...[0, 1, 2, 3].map(i => ['q' + i, 'OUTPUT', 300, i * 50, 'Q' + i])],
  wires: [['clk', 'c', 0], ['r', 'c', 1], ...[0, 1, 2, 3].map(i => ['c', 'q' + i, 0, i])] });
const count = () => [0, 1, 2, 3].reduce((a, i) => a + (led('Q' + i) << i), 0);
const counted = []; for (let i = 0; i < 18; i++) { pulseIn('CLK'); counted.push(count()); }
check('counter chip counts and wraps at 16', counted.slice(0, 3).join() === '1,2,3' && counted[15] === 0 && counted[16] === 1, counted.join());
setIn('RST', true); check('counter reset clears immediately', count() === 0); setIn('RST', false);

spec({ nodes: [['d', 'INPUT', 0, 0, 'D'], ['clk', 'INPUT', 0, 80, 'CLK'], ['s', 'SHIFT4', 150, 0], ...[0, 1, 2, 3].map(i => ['q' + i, 'OUTPUT', 300, i * 50, 'Q' + i])],
  wires: [['d', 's', 0], ['clk', 's', 1], ...[0, 1, 2, 3].map(i => ['s', 'q' + i, 0, i])] });
const shifted = []; for (const bit of [1, 0, 1, 1]) { setIn('D', bit); pulseIn('CLK'); shifted.push([0, 1, 2, 3].map(i => led('Q' + i)).join('')); }
check('shift register moves bits along', shifted.join() === '1000,0100,1010,1101', shifted.join());

const wireAll = (type, inLabels, outLabels) => ({ nodes: [...inLabels.map((l, i) => ['i' + i, 'INPUT', 0, i * 50, l]), ['c', type, 160, 0], ...outLabels.map((l, i) => ['o' + i, 'OUTPUT', 340, i * 50, l])],
  wires: [...inLabels.map((_, i) => ['i' + i, 'c', i]), ...outLabels.map((_, i) => ['c', 'o' + i, 0, i])] });
const setNum = (p, v, k = 4) => { for (let i = 0; i < k; i++) setIn(p + i, (v >> i) & 1); };
const readNum = (p, k = 4) => Array.from({ length: k }, (_, i) => led(p + i) << i).reduce((a, b) => a + b);
spec(wireAll('ADD4', [...'A0 A1 A2 A3 B0 B1 B2 B3 CIN'.split(' ')], 'S0 S1 S2 S3 COUT'.split(' ')));
let addOk = true;
for (const [a, b, c] of [[9, 8, 1], [3, 4, 0], [15, 15, 1], [0, 0, 0]]) { setNum('A', a); setNum('B', b); setIn('CIN', c); addOk &&= readNum('S') + 16 * led('COUT') === a + b + c; }
check('4-bit adder chip adds with carry', addOk);

spec(wireAll('ALU4', 'A0 A1 A2 A3 B0 B1 B2 B3 S0 S1'.split(' '), 'R0 R1 R2 R3 C Z'.split(' ')));
const alu = (a, b, op) => { setNum('A', a); setNum('B', b); setIn('S0', op & 1); setIn('S1', op >> 1); return { r: readNum('R'), c: led('C'), z: led('Z') }; };
check('ALU add/sub/and/or', alu(9, 8, 0).r === 1 && alu(9, 8, 0).c === 1 && alu(5, 3, 1).r === 2 && alu(5, 3, 1).c === 1 && alu(3, 5, 1).c === 0 && alu(12, 10, 2).r === 8 && alu(12, 10, 3).r === 14, JSON.stringify([alu(9, 8, 0), alu(5, 3, 1), alu(12, 10, 2)]));
check('ALU zero flag', alu(5, 5, 1).z === 1 && alu(5, 4, 1).z === 0);

spec({ nodes: [['d', 'INPUT', 0, 0, 'D'], ['e', 'INPUT', 0, 80, 'EN'], ['l', 'DLATCH', 150, 0], ['q', 'OUTPUT', 320, 0, 'Q']], wires: [['d', 'l', 0], ['e', 'l', 1], ['l', 'q', 0]] });
setIn('EN', true); setIn('D', true); const t1 = led('Q'); setIn('EN', false); setIn('D', false); const held = led('Q'); setIn('EN', true);
check('D latch is transparent when enabled and holds otherwise', t1 === 1 && held === 1 && led('Q') === 0);

// ---- bus input
run(`state = specToState({ nodes: [['b', 'BUSIN', 0, 0, undefined, { num: 10 }]], wires: [] }); sim = newSim(); evalAll();`);
check('bus input drives its bits', run('[0,1,2,3].map(i => +val(state.nodes[0].id, i)).join("")') === '0101');
check('bus input clamps to its width', run('importPayload({ nodes: [{ id: 1, type: "BUSIN", x: 0, y: 0, bits: 4, num: 999 }], wires: [] }).nodes[0].num') === (999 & 15));
check('bus width is limited to 4 or 8', run('importPayload({ nodes: [{ id: 1, type: "BUSIN", x: 0, y: 0, bits: 7 }], wires: [] }).nodes[0].bits') === 4 && run('geom({ type: "BUSIN", bits: 8 }).outs.length') === 8);
check('notes keep (truncated) text and do not simulate', run('(() => { const c = importPayload({ nodes: [{ id: 1, type: "NOTE", x: 0, y: 0, text: "x".repeat(500) }], wires: [] }); return c.nodes[0].text.length; })()') === 80);

// ---- propagation delay
const passesUntil = (cond, limit = 30) => run(`(() => { for (let i = 1; i <= ${limit}; i++) { pass(state.nodes, state.wires, sim, true); if (${cond}) return i; } return -1; })()`);
const delayChain = d => { run(`state = specToState({ nodes: [['a', 'INPUT', 0, 0, 'A'], ['n', 'NOT', 150, 0, undefined, { delay: ${d} }], ['y', 'OUTPUT', 300, 10, 'Y']], wires: [['a', 'n', 0], ['n', 'y', 0]] }); sim = newSim(); evalAll(); state.nodes[0].value = true;`); return passesUntil('!val(state.nodes[2].id)'); };
const d1 = delayChain(1), d3 = delayChain(3);
check('gate delay postpones the output by the extra steps', d3 - d1 === 2, `${d1} vs ${d3}`);
check('delay is ignored by instant evaluation', run('(() => { state.nodes[0].value = false; evalAll(); return val(state.nodes[2].id); })()') === true);
// static-1 hazard: Y = A·B + A'·C with B = C = 1 glitches low when A falls and the inverter is slow
spec({ nodes: [['a', 'INPUT', 0, 0, 'A', { value: true }], ['b', 'INPUT', 0, 80, 'B', { value: true }], ['c', 'INPUT', 0, 160, 'C', { value: true }],
  ['n', 'NOT', 120, 0, undefined, { delay: 3 }], ['x', 'AND', 260, 20], ['z', 'AND', 260, 120], ['o', 'OR', 400, 60], ['y', 'OUTPUT', 540, 75, 'Y']],
  wires: [['a', 'n', 0], ['a', 'x', 0], ['b', 'x', 1], ['n', 'z', 0], ['c', 'z', 1], ['x', 'o', 0], ['z', 'o', 1], ['o', 'y', 0]] });
const trace = run(`(() => { const a = state.nodes.find(n => n.label === 'A'), y = state.nodes.find(n => n.label === 'Y'), t = [+val(y.id)];
  a.value = false; for (let i = 0; i < 12; i++) { pass(state.nodes, state.wires, sim, true); t.push(+val(y.id)); } return t.join(''); })()`);
check('slow inverter produces a visible glitch', /1+0+1+$/.test(trace), trace);
check('instant mode never glitches', run('(() => { state.nodes.find(n => n.label === "A").value = true; evalAll(); state.nodes.find(n => n.label === "A").value = false; evalAll(); return +val(state.nodes.find(n => n.label === "Y").id); })()') === 1);

// ---- k-map
const km = run(`kmapHtml(['A', 'B'], [false, true, true, false], ['01', '10'])`);
check('k-map renders a 2x2 grid with outlined groups', /class="kmap"/.test(km) && (km.match(/box-shadow/g) || []).length === 2 && (km.match(/<tr>/g) || []).length === 3, km.slice(0, 120));
const km4 = run(`kmapHtml(['A', 'B', 'C', 'D'], Array.from({ length: 16 }, (_, i) => i % 3 === 0), [])`);
check('4-variable k-map uses Gray-code ordering', /<th>00<\/th><th>01<\/th><th>11<\/th><th>10<\/th>/.test(km4) && (km4.match(/<tr>/g) || []).length === 5);
check('no k-map for 1 or 5 variables', run(`kmapHtml(['A'], [0, 1])`) === '' && run(`kmapHtml(['A','B','C','D','E'], [])`) === '');
check('minimizer uses don\'t-cares to widen groups', run('minimizeSOP(2, [1], [3]).join()') === '-1' && run('minimizeSOP(2, [1]).join()') === '01');
load('Y = (A AND B) OR (A AND NOT B) OR (NOT A AND B)');
const exr = run('circuitExpressions()').rows[0];
check('circuit analysis returns k-map data', Array.isArray(exr.values) && exr.values.length === 4 && exr.implicants.length === 2 && exr.vars.join() === 'A,B', JSON.stringify(exr));

// ---- finite state machines
const f11 = run(`FSM_EXAMPLES['Detect two 1s in a row']`);
const parsed = run(`parseFsm(${JSON.stringify(f11)})`);
check('fsm parses states, inputs and outputs', parsed.states.join() === 'S0,S1' && parsed.inputs.join() === 'X' && parsed.outputs.join() === 'Z' && parsed.transitions.length === 4);
run(`state = buildFsmCircuit(parseFsm(${JSON.stringify(f11)})); sim = newSim(); evalAll();`);
check('fsm circuit has a clock, one flip-flop and no leftover D LEDs', run('state.nodes.filter(n => n.type === "DFF").length') === 1 && run('state.nodes.filter(n => n.type === "CLOCK").length') === 1 && !run('state.nodes.some(n => n.type === "OUTPUT" && n.label === "D0")'));
const clockFsm = () => run(`(() => { const c = state.nodes.find(n => n.type === 'CLOCK'); c.value = true; evalAll(); c.value = false; evalAll(); })()`);
const detect = ((seq) => { run(`state = buildFsmCircuit(parseFsm(${JSON.stringify(f11)})); sim = newSim(); evalAll();`); return seq.map(x => { setIn('X', x); const z = led('Z'); clockFsm(); return z; }).join(''); })([1, 1, 0, 1, 1, 1]);
check('fsm outputs match the transition table step by step', detect === '010011', detect);
for (const bad of ['inputs: A, B, C, D\nS0 0000 -> S0', 'S0 -> S1\nS0 0 -> S1', 'inputs: X\nS0 01 -> S0', 'inputs: Q0\nS0 0 -> S0', 'outputs: Z\nS0 -> S1 / 11', 'foo bar', '']) {
  let threw = false; try { run(`parseFsm(${JSON.stringify(bad)})`); } catch { threw = true; }
  check(`fsm rejects ${JSON.stringify(bad).slice(0, 36)}`, threw);
}
check('fsm warns about missing transitions', run(`fsmEquations(parseFsm("inputs: X\\nA 0 -> B\\nB 1 -> A")).warnings.length`) > 0);
const diag = run(`fsmDiagramSvg(parseFsm(${JSON.stringify(f11)}))`);
check('fsm diagram has a circle per state and arrows', (diag.match(/<circle/g) || []).length === 2 && /marker-end/.test(diag) && /<svg/.test(diag));
for (const [name, text] of Object.entries(run('FSM_EXAMPLES'))) {
  let ok = true, why = ''; try { run(`(() => { const f = parseFsm(${JSON.stringify(text)}); const s = buildFsmCircuit(f); const c = sanitizeCircuit(s); if (!c) throw new Error('invalid circuit'); fsmDiagramSvg(f); })()`); } catch (e) { ok = false; why = e.message; }
  check(`fsm example builds a valid circuit: ${name}`, ok, why);
}
// traffic light: three states cycle green -> yellow -> red
run(`state = buildFsmCircuit(parseFsm(FSM_EXAMPLES['Traffic light (3 states)'])); sim = newSim(); evalAll();`);
const lights = []; for (let i = 0; i < 4; i++) { lights.push(['R', 'Y', 'G'].map(l => led(l)).join('')); clockFsm(); }
check('fsm traffic light cycles G -> Y -> R -> G', lights.join() === '001,010,100,001', lights.join());

// ---- Verilog
load('Y = (A AND B) OR NOT C');
const ver = run('toVerilog()');
check('verilog export has ports, primitives and an assign', /module logic_lab_circuit\(/.test(ver.text) && /input A/.test(ver.text) && /output Y/.test(ver.text) && /\band g\d+/.test(ver.text) && ver.unsupported.length === 0, ver.text);
const before = table();
run(`state = circuitFromVerilog(${JSON.stringify(ver.text)}); sim = newSim(); evalAll();`);
check('verilog round-trips to the same behaviour', table().join() === before.join(), table().join() + ' vs ' + before.join());
run(`state = circuitFromVerilog("module m(input a, input b, output y); wire w; and g1(w, a, b); assign y = ~w | (a ^ b); endmodule"); sim = newSim(); evalAll();`);
check('verilog import handles ANSI ports, primitives and assigns', table().join() === '00>1,01>1,10>1,11>0', table().join());
run(`state = circuitFromVerilog("nand (y, a, b); // implicit output"); sim = newSim(); evalAll();`);
check('verilog import infers outputs and anonymous gates', table().join() === '00>1,01>1,10>1,11>0' && run('state.nodes.filter(n => n.type === "OUTPUT").length') === 1, table().join());
run(`state = circuitFromVerilog("wire t = a & b; assign y = t | c;"); sim = newSim(); evalAll();`);
check('verilog import handles "wire w = expr"', run('state.nodes.some(n => n.type === "INPUT" && n.label === "c")') && table().length === 8);
run(`state = circuitFromVerilog("not n1(or, a); assign y = or;"); sim = newSim(); evalAll();`);   // "or" is a keyword in expressions
check('verilog import copes with names that clash with keywords', table().length === 2);
for (const bad of ['input [3:0] a; assign y = a;', 'assign y = a ? b : c;', 'and g(y, a, b); and h(y, a, b);', 'assign a = ~b; assign b = ~a;', 'always @(posedge c) q <= d;', '']) {
  let threw = false; try { run(`circuitFromVerilog(${JSON.stringify(bad)})`); } catch { threw = true; }
  check(`verilog import rejects ${JSON.stringify(bad).slice(0, 36)}`, threw);
}
run(`state = specToState({ nodes: [['c', 'INPUT', 0, 0, 'CLK'], ['d', 'INPUT', 0, 80, 'D'], ['f', 'DFF', 150, 0], ['q', 'OUTPUT', 320, 0, 'Q'], ['b', 'BCD7', 150, 150]], wires: [['c', 'f', 1], ['d', 'f', 0], ['f', 'q', 0]] }); sim = newSim();`);
const vff = run('toVerilog()');
check('verilog export maps flip-flops and lists unsupported parts', /always @\(posedge/.test(vff.text) && vff.unsupported.some(u => /BCD7/.test(u)) && /NOT translated/.test(vff.text), vff.text);

// ---- auto layout
const layoutOf = s => run(`(() => { const st = specToState(${JSON.stringify(s)}); const p = autoLayout(st.nodes, st.wires); return { st, p: [...p] }; })()`);
const adderSpec = { nodes: [['a', 'INPUT', 500, 300, 'A'], ['b', 'INPUT', 20, 20, 'B'], ['x', 'XOR', 700, 10], ['n', 'AND', 10, 400], ['s', 'OUTPUT', 0, 0, 'S'], ['c', 'OUTPUT', 300, 300, 'C']],
  wires: [['a', 'x', 0], ['b', 'x', 1], ['a', 'n', 0], ['b', 'n', 1], ['x', 's', 0], ['n', 'c', 0]] };
const lay = layoutOf(adderSpec);
check('layout assigns every part a position', lay.p.length === 6);
check('layout flows left to right along wires', run(`(() => { const st = specToState(${JSON.stringify(adderSpec)}); const p = autoLayout(st.nodes, st.wires); return st.wires.every(w => p.get(w.from).x < p.get(w.to).x); })()`));
check('layout never overlaps parts', run(`(() => { const st = specToState(${JSON.stringify(adderSpec)}); const p = autoLayout(st.nodes, st.wires); const r = st.nodes.map(n => { const g = geom(n), q = p.get(n.id); return [q.x, q.y, q.x + g.w, q.y + g.h]; });
  return r.every((a, i) => r.every((b, j) => i === j || a[2] <= b[0] || b[2] <= a[0] || a[3] <= b[1] || b[3] <= a[1])); })()`));
check('layout terminates on feedback circuits', run(`(() => { const st = specToState(EXAMPLES_SR); return autoLayout(st.nodes, st.wires).size === st.nodes.length; })()`.replace('EXAMPLES_SR', JSON.stringify({ nodes: [['r', 'INPUT', 0, 0, 'R'], ['s', 'INPUT', 0, 100, 'S'], ['n1', 'NOR', 100, 0], ['n2', 'NOR', 100, 100], ['q', 'OUTPUT', 300, 0, 'Q']], wires: [['r', 'n1', 0], ['s', 'n2', 0], ['n1', 'n2', 1], ['n2', 'n1', 1], ['n1', 'q', 0]] }))));
check('layout leaves notes where they are', run(`(() => { const st = specToState({ nodes: [['n', 'NOTE', 0, 0, undefined, { text: 'hi' }], ['a', 'INPUT', 0, 50, 'A']], wires: [] }); const p = autoLayout(st.nodes, st.wires); return !p.has(st.nodes[0].id) && p.has(st.nodes[1].id); })()`));

// ---- lessons
check('lesson ids are unique and non-empty', run('new Set(LESSONS.map(l => l.id)).size === LESSONS.length && LESSONS.every(l => l.steps.length > 0)'));
check('every lesson circuit is a valid circuit', run('LESSONS.every(l => l.steps.every(s => !s.spec || sanitizeCircuit(specToState(s.spec)) !== null))'));
check('every quiz has a circuit and an LED to read', run(`LESSONS.every(l => l.steps.every((s, i) => { if (!s.quiz) return true; const sp = lessonSpec(l, i); if (!sp) return false; const st = specToState(sp); return st.nodes.some(n => n.type === 'OUTPUT' && n.label === s.quiz.predict.out); }))`));
const answers = run(`LESSONS.flatMap(l => l.steps.map((s, i) => s.quiz ? lessonAnswer(lessonSpec(l, i), s.quiz.predict) : null).filter(a => a !== null))`);
check('every quiz answer is computed as 0 or 1', answers.length >= 10 && answers.every(a => a === 0 || a === 1), answers.join());
check('quiz answers match known logic', run(`lessonAnswer(${JSON.stringify(gateSpecFor())}, { set: { A: 1, B: 0 }, out: 'Y' })`) === 0, 'AND(1,0)');
function gateSpecFor() { return { nodes: [['a', 'INPUT', 40, 30, 'A'], ['b', 'INPUT', 40, 110, 'B'], ['g', 'AND', 200, 50], ['y', 'OUTPUT', 360, 65, 'Y']], wires: [['a', 'g', 0], ['b', 'g', 1], ['g', 'y', 0]] }; }
check('sequence quiz: 3 clock pulses on a toggle flip-flop gives 1', run(`lessonAnswer(TOGGLE_FF, { steps: [{ pulse: 'CLK' }, { pulse: 'CLK' }, { pulse: 'CLK' }], out: 'Q' })`) === 1);
check('latch quiz: holds after S returns to 0', run(`lessonAnswer(SR_LATCH, { steps: [{ set: { S: 1, R: 0 } }, { set: { S: 0, R: 0 } }], out: 'Q' })`) === 1);
check('lesson simulation leaves the live circuit untouched', run(`(() => { state = specToState(${JSON.stringify(gateSpecFor())}); const before = JSON.stringify(state); lessonAnswer(TOGGLE_FF, { set: {}, out: 'Q' }); return JSON.stringify(state) === before; })()`));

// ---- sequential challenges
const seqCheck = (id, specText) => { run(`state = specToState(${JSON.stringify(specText)}); sim = newSim(); evalAll(); globalThis.__r = checkChallenge(CHALLENGES.find(c => c.id === ${JSON.stringify(id)}));`); return run('__r'); };
const ff = (id, x, y) => [id, 'DFF', x, y];
check('seq challenge: toggle flip-flop', seqCheck('toggle', { nodes: [['c', 'INPUT', 0, 0, 'CLK'], ff('f', 150, 0), ['q', 'OUTPUT', 320, 10, 'Q']], wires: [['c', 'f', 1], ['f', 'f', 0, 1], ['f', 'q', 0]] }).ok);
check('seq challenge: wrong toggle is explained', (r => !r.ok && /Step 1 of 4/.test(r.msg) && /CLK/.test(r.msg))(seqCheck('toggle', { nodes: [['c', 'INPUT', 0, 0, 'CLK'], ff('f', 150, 0), ['q', 'OUTPUT', 320, 10, 'Q']], wires: [['c', 'f', 1], ['f', 'q', 0]] })), run('__r.msg'));
check('seq challenge: SR latch from NOR gates', seqCheck('sr-latch', { nodes: [['r', 'INPUT', 0, 0, 'R'], ['s', 'INPUT', 0, 150, 'S'], ['n1', 'NOR', 150, 0], ['n2', 'NOR', 150, 140], ['q', 'OUTPUT', 320, 10, 'Q']],
  wires: [['r', 'n1', 0], ['s', 'n2', 0], ['n1', 'n2', 1], ['n2', 'n1', 1], ['n1', 'q', 0]] }).ok);
check('seq challenge: a gate-only circuit cannot hold state', !seqCheck('sr-latch', { nodes: [['r', 'INPUT', 0, 0, 'R'], ['s', 'INPUT', 0, 150, 'S'], ['o', 'OR', 150, 0], ['q', 'OUTPUT', 320, 10, 'Q']], wires: [['s', 'o', 0], ['r', 'o', 1], ['o', 'q', 0]] }).ok);
check('seq challenge: 2-bit counter', seqCheck('count2', { nodes: [['c', 'INPUT', 0, 0, 'CLK'], ff('f0', 150, 0), ff('f1', 150, 120), ['x', 'XOR', 300, 60], ['q0', 'OUTPUT', 460, 10, 'Q0'], ['q1', 'OUTPUT', 460, 130, 'Q1']],
  wires: [['c', 'f0', 1], ['c', 'f1', 1], ['f0', 'f0', 0, 1], ['f1', 'x', 0], ['f0', 'x', 1], ['x', 'f1', 0], ['f0', 'q0', 0], ['f1', 'q1', 0]] }).ok);
check('seq challenge: 1-0-1 detector with a shift register', seqCheck('detect101', { nodes: [['x', 'INPUT', 0, 0, 'X'], ['c', 'INPUT', 0, 80, 'CLK'], ['s', 'SHIFT4', 150, 0], ['n', 'NOT', 330, 80], ['a', 'AND', 440, 40, undefined, { n: 3 }], ['h', 'OUTPUT', 600, 60, 'HIT']],
  wires: [['x', 's', 0], ['c', 's', 1], ['s', 'a', 0, 0], ['s', 'n', 0, 1], ['n', 'a', 1], ['s', 'a', 2, 2], ['a', 'h', 0]] }).ok);
check('seq check restores the live switches', run(`(() => { state.nodes.find(n => n.label === 'X').value = true; checkChallenge(CHALLENGES.find(c => c.id === 'detect101')); return state.nodes.find(n => n.label === 'X').value; })()`) === true);
check('seq challenge table renders its steps', /<th>Expect<\/th>/.test(run(`challengeTable(CHALLENGES.find(c => c.id === 'count2'))`)));

// ---- custom challenges
load('Y = A XOR B');
run(`globalThis.__cap = captureChallenge({ title: 'My XOR', desc: 'Make <b>xor</b>', hint: 'think', allowed: ['AND', 'OR', 'NOT', 'BOGUS'] });`);
const cap = run('__cap');
check('capture records the truth table and filters gate names', cap.ins.join() === 'A,B' && cap.outs.join() === 'Y' && cap.table.join('|') === '0|1|1|0'.replace(/\|/g, '|') && cap.allowed.join() === 'AND,OR,NOT', JSON.stringify(cap));
run(`globalThis.__cc = makeCustomChallenge(JSON.parse(${JSON.stringify(JSON.stringify(cap))}));`);
check('custom challenge escapes author text', run('__cc.learn.includes("&lt;b&gt;")') && !run('__cc.learn').includes('<b>'));
run(`state = challengeScaffold(__cc); sim = newSim(); state = buildCircuit(parseProgram("Y = A XOR B")); sim = newSim(); evalAll(); globalThis.__res = checkChallenge(__cc);`);
check('custom challenge rejects a disallowed gate', run('__res.ok') === false && /only allows/.test(run('__res.msg')));
run(`state = buildCircuit(parseProgram("Y = (A AND NOT B) OR (NOT A AND B)")); sim = newSim(); evalAll(); globalThis.__res = checkChallenge(__cc);`);
check('custom challenge accepts a correct solution', run('__res.ok') === true, run('__res.msg'));
for (const [name, bad] of [['bad table length', { ins: ['A'], outs: ['Y'], table: [[0]] }], ['bad label', { ins: ['A B'], outs: ['Y'], table: [[0], [1]] }], ['duplicate labels', { ins: ['A'], outs: ['A'], table: [[0], [1]] }],
  ['too many inputs', { ins: ['A', 'B', 'C', 'D', 'E', 'F'], outs: ['Y'], table: new Array(64).fill([0]) }], ['non-binary cells', { ins: ['A'], outs: ['Y'], table: [[0], [7]] }], ['not an object', 'x']]) {
  check(`custom challenge rejects ${name}`, run(`makeCustomChallenge(${JSON.stringify(bad)})`) === null);
}
check('capture refuses sequential circuits', !!run(`(() => { state = specToState({ nodes: [['d', 'INPUT', 0, 0, 'D'], ['f', 'DFF', 100, 0], ['q', 'OUTPUT', 250, 0, 'Q']], wires: [['d', 'f', 0], ['f', 'q', 0]] }); return captureChallenge({}).error; })()`));

// ---- progress
store.clear();
check('progress round-trips', (() => { run(`markDone('not'); markLessonDone('gates');`); const p = run('progressPayload()'); store.clear(); return run(`mergeProgress(${JSON.stringify(p)})`) === 2 && run(`doneSet().has('not') && lessonsDone().has('gates')`); })());
check('progress ignores unknown ids and other files', run(`mergeProgress({ app: 'logic-lab', kind: 'progress', challenges: ['nope', 7], lessons: ['x'] })`) === 0 && run(`mergeProgress({ app: 'other' })`) === null && run('mergeProgress(null)') === null);

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
