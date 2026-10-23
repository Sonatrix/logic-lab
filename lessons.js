'use strict';
// Short guided lessons. Each step shows some text, optionally loads a circuit, and optionally asks a prediction
// question. The correct answer to every question is computed by simulating the lesson circuit, never hard-coded.
// No DOM access.

const LESSON_DONE_KEY = 'logic-lab-lessons-done';
const lessonsDone = () => { try { return new Set(JSON.parse(localStorage.getItem(LESSON_DONE_KEY)) || []); } catch { return new Set(); } };
const markLessonDone = id => { const s = lessonsDone(); s.add(id); try { localStorage.setItem(LESSON_DONE_KEY, JSON.stringify([...s])); } catch { /* ignore */ } };

// small circuit builders (top-left coordinates, like the examples)
const gate1 = (type, outLabel = 'Y') => ({
  nodes: [['a', 'INPUT', 40, 60, 'A'], ['g', type, 200, 50], ['y', 'OUTPUT', 360, 65, outLabel]],
  wires: [['a', 'g', 0], ['g', 'y', 0]],
});
const gate2 = (type, outLabel = 'Y') => ({
  nodes: [['a', 'INPUT', 40, 30, 'A'], ['b', 'INPUT', 40, 110, 'B'], ['g', type, 200, 50], ['y', 'OUTPUT', 360, 65, outLabel]],
  wires: [['a', 'g', 0], ['b', 'g', 1], ['g', 'y', 0]],
});
const HALF_ADDER = {
  nodes: [['a', 'INPUT', 40, 40, 'A'], ['b', 'INPUT', 40, 140, 'B'], ['x', 'XOR', 200, 30], ['n', 'AND', 200, 130], ['s', 'OUTPUT', 360, 45, 'SUM'], ['c', 'OUTPUT', 360, 145, 'CARRY']],
  wires: [['a', 'x', 0], ['b', 'x', 1], ['a', 'n', 0], ['b', 'n', 1], ['x', 's', 0], ['n', 'c', 0]],
};
const FULL_ADDER = {
  nodes: [['a', 'INPUT', 30, 30, 'A'], ['b', 'INPUT', 30, 110, 'B'], ['ci', 'INPUT', 30, 210, 'CIN'], ['x1', 'XOR', 160, 50], ['x2', 'XOR', 300, 90], ['a1', 'AND', 160, 140],
          ['a2', 'AND', 300, 190], ['o', 'OR', 440, 170], ['s', 'OUTPUT', 460, 100, 'SUM'], ['co', 'OUTPUT', 540, 180, 'COUT']],
  wires: [['a', 'x1', 0], ['b', 'x1', 1], ['x1', 'x2', 0], ['ci', 'x2', 1], ['a', 'a1', 0], ['b', 'a1', 1], ['x1', 'a2', 0], ['ci', 'a2', 1],
          ['a1', 'o', 0], ['a2', 'o', 1], ['x2', 's', 0], ['o', 'co', 0]],
};
const SR_LATCH = {
  nodes: [['r', 'INPUT', 40, 30, 'R'], ['s', 'INPUT', 40, 160, 'S'], ['n1', 'NOR', 220, 30], ['n2', 'NOR', 220, 150], ['q', 'OUTPUT', 390, 40, 'Q'], ['qn', 'OUTPUT', 390, 160, 'QN']],
  wires: [['r', 'n1', 0], ['s', 'n2', 0], ['n1', 'n2', 1], ['n2', 'n1', 1], ['n1', 'q', 0], ['n2', 'qn', 0]],
};
const TOGGLE_FF = {
  nodes: [['clk', 'INPUT', 40, 80, 'CLK'], ['ff', 'DFF', 200, 50], ['q', 'OUTPUT', 360, 60, 'Q']],
  wires: [['clk', 'ff', 1], ['ff', 'ff', 0, 1], ['ff', 'q', 0]],
};
const COUNTER_DEMO = {
  nodes: [['clk', 'INPUT', 40, 100, 'CLK'], ['c', 'COUNTER4', 200, 50], ['n', 'BUSOUT', 380, 50], ['q0', 'OUTPUT', 500, 40, 'Q0'], ['q1', 'OUTPUT', 500, 100, 'Q1'], ['q2', 'OUTPUT', 500, 160, 'Q2']],
  wires: [['clk', 'c', 0], ...[0, 1, 2, 3].map(i => ['c', 'n', i, i]), ['c', 'q0', 0, 0], ['c', 'q1', 0, 1], ['c', 'q2', 0, 2]],
};

// predict: { steps | set, out }   steps: [{ set: {A: 1}, pulse: 'CLK' }]   -> the answer is read from LED `out`
const LESSONS = [
  { id: 'basics', title: 'Signals, switches and LEDs', steps: [
    { html: 'Digital circuits only know two values: <b>0</b> (off) and <b>1</b> (on). Here a <b>switch</b> is wired straight to an <b>LED</b>. Click the switch A, and watch the LED follow it.',
      spec: { nodes: [['a', 'INPUT', 40, 60, 'A'], ['y', 'OUTPUT', 260, 70, 'Y']], wires: [['a', 'y', 0]] } },
    { html: 'Wires carry values from a part’s <b>output dot</b> (right) to another part’s <b>input dot</b> (left). Green means 1.',
      quiz: { q: 'If switch A is set to 1, what will the LED Y show?', predict: { set: { A: 1 }, out: 'Y' } } },
    { html: 'A <b>NOT</b> gate (inverter) sits in the middle and flips whatever comes in.', spec: gate1('NOT'),
      quiz: { q: 'With A = 1, what does the LED show after the NOT gate?', predict: { set: { A: 1 }, out: 'Y' } } },
  ] },
  { id: 'gates', title: 'AND, OR, XOR and NAND', steps: [
    { html: '<b>AND</b> outputs 1 only when <b>both</b> inputs are 1. Try all four switch combinations.', spec: gate2('AND'),
      quiz: { q: 'A = 1 and B = 0. What is Y?', predict: { set: { A: 1, B: 0 }, out: 'Y' } } },
    { html: '<b>OR</b> outputs 1 when <b>at least one</b> input is 1.', spec: gate2('OR'),
      quiz: { q: 'A = 1 and B = 0. What is Y?', predict: { set: { A: 1, B: 0 }, out: 'Y' } } },
    { html: '<b>XOR</b> (exclusive or) outputs 1 when the inputs <b>differ</b>.', spec: gate2('XOR'),
      quiz: { q: 'A = 1 and B = 1. What is Y?', predict: { set: { A: 1, B: 1 }, out: 'Y' } } },
    { html: '<b>NAND</b> is AND followed by NOT. The small circle on the output means “inverted”.', spec: gate2('NAND'),
      quiz: { q: 'A = 1 and B = 1. What is Y?', predict: { set: { A: 1, B: 1 }, out: 'Y' } } },
  ] },
  { id: 'adder', title: 'Adding with gates', steps: [
    { html: 'A <b>half adder</b> adds two bits. <b>XOR</b> gives the sum bit and <b>AND</b> gives the carry. Binary 1 + 1 = 10: sum 0, carry 1.', spec: HALF_ADDER,
      quiz: { q: 'A = 1 and B = 1. What does the SUM LED show?', predict: { set: { A: 1, B: 1 }, out: 'SUM' } } },
    { html: 'Same circuit: what about the carry?',
      quiz: { q: 'A = 1 and B = 1. What does the CARRY LED show?', predict: { set: { A: 1, B: 1 }, out: 'CARRY' } } },
    { html: 'A <b>full adder</b> also accepts a carry-in (CIN) from the previous column. Chain several together to add bigger numbers.', spec: FULL_ADDER,
      quiz: { q: 'A = 1, B = 1, CIN = 1 (that is 1+1+1 = 3, binary 11). What is COUT?', predict: { set: { A: 1, B: 1, CIN: 1 }, out: 'COUT' } } },
  ] },
  { id: 'memory', title: 'Memory: the SR latch', steps: [
    { html: 'Feeding a gate’s output back into another gate’s input creates <b>memory</b>. This latch has two NOR gates wired in a loop. <b>S</b> sets Q to 1, <b>R</b> resets it to 0. Try: S on, S off, R on, R off.', spec: SR_LATCH },
    { html: 'The magic is what happens when both inputs are 0 again: the latch <b>holds</b> its last value.',
      quiz: { q: 'Set S = 1 (with R = 0), then set S back to 0. What does Q show?', predict: { steps: [{ set: { S: 1, R: 0 } }, { set: { S: 0, R: 0 } }], out: 'Q' } } },
  ] },
  { id: 'clock', title: 'Clocks and flip-flops', steps: [
    { html: 'A <b>D flip-flop</b> copies its D input to Q only at the instant the clock rises from 0 to 1. Here Q̄ (the inverse) is wired back to D, so every clock pulse makes Q <b>toggle</b>. Click the CLK switch on and off.', spec: TOGGLE_FF },
    { html: 'Each full pulse (0 → 1 → 0) flips Q once, so Q changes at half the clock rate: a <b>divide-by-2</b>.',
      quiz: { q: 'After 3 clock pulses, what does Q show? (It starts at 0.)', predict: { steps: [{ pulse: 'CLK' }, { pulse: 'CLK' }, { pulse: 'CLK' }], out: 'Q' } } },
  ] },
  { id: 'counting', title: 'Counting in binary', steps: [
    { html: 'A <b>counter</b> chip is flip-flops arranged to count clock pulses in binary. Pulse the CLK switch and watch the number display and the bit LEDs (Q0 is the least significant bit).', spec: COUNTER_DEMO },
    { html: 'Five pulses make the number 5, which is <b>0101</b> in binary: Q2 = 1, Q1 = 0, Q0 = 1.',
      quiz: { q: 'After 5 clock pulses, what does Q2 show?', predict: { steps: [1, 2, 3, 4, 5].map(() => ({ pulse: 'CLK' })), out: 'Q2' } } },
  ] },
];

// Correct answer (0 or 1) for a quiz, found by simulating the step's circuit.
function lessonAnswer(spec, predict) {
  return withCircuit(specToState(spec), () => {
    evalAll();
    const steps = predict.steps || [{ set: predict.set }];
    for (const st of steps) applyStepOnce(st, evalAll);
    const led = state.nodes.find(n => n.type === 'OUTPUT' && n.label === predict.out);
    return led && val(led.id) ? 1 : 0;
  });
}

// The circuit shown for a given step: the most recent spec at or before it.
const lessonSpec = (lesson, idx) => { for (let i = idx; i >= 0; i--) if (lesson.steps[i].spec) return lesson.steps[i].spec; return null; };
