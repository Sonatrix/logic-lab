'use strict';
// Boolean expressions <-> circuits. No DOM access.
//   Operators (loosest to tightest): OR NOR | XOR XNOR | AND NAND | NOT (prefix) and postfix '
//   Symbols: + | ∨ = OR   * & · ∧ = AND   ^ ⊕ = XOR   ! ~ ¬ = NOT.   Constants 0 and 1.
//   A program is lines of `NAME = expression`; later lines may use earlier names.

const KEYWORDS = { AND: 'AND', OR: 'OR', XOR: 'XOR', NAND: 'NAND', NOR: 'NOR', XNOR: 'XNOR', NOT: 'NOT' };
const SYMBOLS = { '&': 'AND', '*': 'AND', '·': 'AND', '∧': 'AND', '|': 'OR', '+': 'OR', '∨': 'OR', '^': 'XOR', '⊕': 'XOR', '!': 'NOT', '~': 'NOT', '¬': 'NOT' };

function tokenize(src) {
  const toks = [];
  const re = /\s*(?:([A-Za-z_][A-Za-z0-9_]*)|(\d+)|(.))/gy;
  let m;
  while (re.lastIndex < src.length && (m = re.exec(src))) {
    if (m[1] !== undefined) {
      const kw = KEYWORDS[m[1].toUpperCase()];
      toks.push(kw === 'NOT' ? { t: 'not', s: m[1] } : kw ? { t: 'op', v: kw, s: m[1] } : { t: 'id', v: m[1], s: m[1] });
    } else if (m[2] !== undefined) {
      if (m[2] !== '0' && m[2] !== '1') throw new Error(`Only the constants 0 and 1 are allowed (found "${m[2]}")`);
      toks.push({ t: 'const', v: m[2] === '1', s: m[2] });
    } else if (m[3] === '(' || m[3] === ')' || m[3] === "'") toks.push({ t: m[3], s: m[3] });
    else if (SYMBOLS[m[3]] === 'NOT') toks.push({ t: 'not', s: m[3] });
    else if (SYMBOLS[m[3]]) toks.push({ t: 'op', v: SYMBOLS[m[3]], s: m[3] });
    else if (m[3].trim()) throw new Error(`Unexpected character "${m[3]}"`);
    else break;
  }
  return toks;
}

function parseExpr(src) {
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i];
  const mk = (op, l, r) => {
    if (op === 'AND' || op === 'OR' || op === 'XOR') {          // associative: flatten into one n-ary gate
      const args = [];
      for (const x of [l, r]) if (x.t === 'op' && x.op === op) args.push(...x.args); else args.push(x);
      return { t: 'op', op, args };
    }
    return { t: 'op', op, args: [l, r] };
  };
  const level = (sub, ops) => () => {
    let l = sub();
    while (peek() && peek().t === 'op' && ops.includes(peek().v)) { const op = toks[i++].v; l = mk(op, l, sub()); }
    return l;
  };
  const atom = () => {
    const tok = toks[i++];
    if (!tok) throw new Error('Expression ended unexpectedly');
    if (tok.t === 'id') return { t: 'var', name: tok.v };
    if (tok.t === 'const') return { t: 'const', v: tok.v };
    if (tok.t === '(') {
      const e = or();
      if (!peek() || peek().t !== ')') throw new Error('Missing closing parenthesis');
      i++;
      return e;
    }
    throw new Error(`Unexpected "${tok.s}"`);
  };
  const postfix = () => { let a = atom(); while (peek() && peek().t === "'") { i++; a = { t: 'not', a }; } return a; };
  const unary = () => { if (peek() && peek().t === 'not') { i++; return { t: 'not', a: unary() }; } return postfix(); };
  const and = level(unary, ['AND', 'NAND']);
  const xor = level(and, ['XOR', 'XNOR']);
  const or = level(xor, ['OR', 'NOR']);
  const ast = or();
  if (i < toks.length) throw new Error(`Unexpected "${toks[i].s}"`);
  return ast;
}

// "Y = A AND B" lines -> [{name, ast}]. Throws Error with a line number on bad input.
function parseProgram(text) {
  const lines = [], seen = new Set();
  text.split(/[\n;]/).forEach((raw, idx) => {
    const line = raw.replace(/(#|\/\/).*$/, '').trim();
    if (!line) return;
    try {
      const eq = line.indexOf('=');
      let name = `Y${lines.length + 1}`, body = line;
      if (eq >= 0) {
        name = line.slice(0, eq).trim(); body = line.slice(eq + 1);
        if (!/^[A-Za-z_]\w*$/.test(name)) throw new Error(`"${name}" is not a valid name`);
      }
      if (seen.has(name)) throw new Error(`"${name}" is defined twice`);
      seen.add(name);
      lines.push({ name, ast: parseExpr(body) });
    } catch (e) { throw new Error(`Line ${idx + 1}: ${e.message}`); }
  });
  if (!lines.length) throw new Error('Type at least one expression, e.g.  Y = A AND (B OR NOT C)');
  return lines;
}

// Build a new circuit state from parsed lines. The global `state` is swapped temporarily so
// the caller decides whether to adopt the result (and can record undo history first).
// opts.ledFor: only these names get an LED (default: every line); opts.inputOrder: names to create first, in this order.
function buildCircuit(lines, opts = {}) {
  const defined = new Set(lines.map(l => l.name));
  const g = [], memo = new Map(), inputs = new Map(), sig = new Map();
  const mkNode = o => { o.uid = g.length; g.push(o); return o; };
  const gate = (type, ins) => {
    const key = `${type}|${ins.map(x => x.uid)}`;
    if (!memo.has(key)) memo.set(key, mkNode({ type, ins, depth: 1 + Math.max(...ins.map(x => x.depth)) }));
    return memo.get(key);
  };
  const nary = (op, args) => {                                   // honour the 8-input gate limit
    while (args.length > MAX_INPUTS) args = Array.from({ length: Math.ceil(args.length / MAX_INPUTS) }, (_, k) => {
      const chunk = args.slice(k * MAX_INPUTS, (k + 1) * MAX_INPUTS);
      return chunk.length === 1 ? chunk[0] : gate(op, chunk);
    });
    return gate(op, args);
  };
  const build = ast => {
    switch (ast.t) {
      case 'var':
        if (defined.has(ast.name)) {
          if (!sig.has(ast.name)) throw new Error(`"${ast.name}" is used before it is defined`);
          return sig.get(ast.name);
        }
        if (!inputs.has(ast.name)) inputs.set(ast.name, mkNode({ type: 'INPUT', label: ast.name.slice(0, 6), ins: [], depth: 0 }));
        return inputs.get(ast.name);
      case 'const': {
        const type = ast.v ? 'HIGH' : 'LOW';
        if (!memo.has(type)) memo.set(type, mkNode({ type, ins: [], depth: 0 }));
        return memo.get(type);
      }
      case 'not': return gate('NOT', [build(ast.a)]);
      default: return ['AND', 'OR', 'XOR'].includes(ast.op) ? nary(ast.op, ast.args.map(build)) : gate(ast.op, ast.args.map(build));
    }
  };
  for (const name of opts.inputOrder || []) {
    if (!defined.has(name) && !inputs.has(name)) inputs.set(name, mkNode({ type: 'INPUT', label: name.slice(0, 6), ins: [], depth: 0 }));
  }
  const outsList = [];
  for (const { name, ast } of lines) {
    const node = build(ast);
    sig.set(name, node);
    if (!opts.ledFor || opts.ledFor.has(name)) outsList.push(mkNode({ type: 'OUTPUT', label: name.slice(0, 6), ins: [node], depth: node.depth + 1 }));
  }

  // layout: one column per depth, rows ordered by the average height of their inputs
  const heightOf = n => geom({ type: n.type, n: n.ins.length > 2 ? n.ins.length : undefined }).h;
  const maxDepth = Math.max(...g.map(n => n.depth));
  for (let d = 0; d <= maxDepth; d++) {
    const layer = g.filter(n => n.depth === d);
    const want = n => n.ins.length ? n.ins.reduce((s, x) => s + x.cy, 0) / n.ins.length : null;
    layer.forEach(n => { n.want = want(n); });
    if (d > 0) layer.sort((a, b) => a.want - b.want);
    let cursor = 20;
    for (const n of layer) {
      const h = heightOf(n), top = Math.max(cursor, (n.want ?? cursor + h / 2) - h / 2);
      n.cy = top + h / 2; n.cx = 70 + d * 150; cursor = top + h + 24;
    }
  }

  const keep = state;
  state = fresh();
  try {
    const made = new Map();
    for (const n of g) {
      const extra = n.ins.length > 2 ? { n: n.ins.length } : undefined;
      made.set(n.uid, addNode(n.type, n.cx, n.cy, n.label, extra));
    }
    for (const n of g) n.ins.forEach((src, i) => connect(made.get(src.uid).id, 0, made.get(n.uid).id, i));
    state.counters.INPUT = inputs.size;
    state.counters.OUTPUT = outsList.length;
    return state;
  } finally { state = keep; }
}

// ---------------------------------------------------------------- circuit -> expression
function exprOfInput(n, i, stack) {
  const w = state.wires.find(w => w.to === n.id && w.port === i);
  if (!w) return '0';                                           // a floating input reads as 0
  const src = byId(w.from);
  return src ? exprOfNode(src, stack) : null;
}

function exprOfNode(n, stack) {
  if (stack.has(n.id)) return null;                             // feedback loop
  if (n.type === 'INPUT') return n.label;
  if (n.type === 'HIGH') return '1';
  if (n.type === 'LOW') return '0';
  if (!isGate(n.type)) return null;                             // clocks, chips, blocks ... not expressible
  stack.add(n.id);
  const a = geom(n).ins.map((_, i) => exprOfInput(n, i, stack));
  stack.delete(n.id);
  if (a.includes(null)) return null;
  const join = op => a.length > 1 ? `(${a.join(` ${op} `)})` : a[0];
  switch (n.type) {
    case 'AND': return join('AND');
    case 'OR': return join('OR');
    case 'XOR': return join('XOR');
    case 'NAND': return `NOT ${join('AND')}`;
    case 'NOR': return `NOT ${join('OR')}`;
    case 'XNOR': return `NOT ${join('XOR')}`;
    case 'NOT': return `NOT ${a[0]}`;
    default: return a[0];                                       // BUFFER
  }
}

const stripParens = s => /^\((.*)\)$/.test(s) && depthBalanced(s.slice(1, -1)) ? s.slice(1, -1) : s;
function depthBalanced(s) { let d = 0; for (const c of s) { if (c === '(') d++; else if (c === ')' && --d < 0) return false; } return d === 0; }

// Quine–McCluskey: minimal sum-of-products for the given minterms. Returns patterns like "1-0".
// `dontCares` are inputs whose output does not matter; they may be used to make groups bigger.
function minimizeSOP(nvars, minterms, dontCares = []) {
  if (!minterms.length) return [];
  let terms = new Map([...minterms, ...dontCares].map(m => [m.toString(2).padStart(nvars, '0'), new Set([m])]));
  const primes = new Map();
  while (terms.size) {
    const used = new Set(), next = new Map(), keys = [...terms.keys()];
    for (let a = 0; a < keys.length; a++) for (let b = a + 1; b < keys.length; b++) {
      let diff = -1;
      for (let k = 0; k < nvars; k++) if (keys[a][k] !== keys[b][k]) { if (diff >= 0 || keys[a][k] === '-' || keys[b][k] === '-') { diff = -2; break; } diff = k; }
      if (diff < 0) continue;
      const merged = keys[a].slice(0, diff) + '-' + keys[a].slice(diff + 1);
      used.add(keys[a]); used.add(keys[b]);
      next.set(merged, new Set([...terms.get(keys[a]), ...terms.get(keys[b])]));
    }
    for (const k of keys) if (!used.has(k)) primes.set(k, terms.get(k));
    terms = next;
  }
  const chosen = new Set(), left = new Set(minterms);
  const take = k => { chosen.add(k); primes.get(k).forEach(m => left.delete(m)); };
  for (const m of minterms) {                                   // essential prime implicants first
    const cover = [...primes].filter(([, ms]) => ms.has(m));
    if (cover.length === 1 && left.has(m)) take(cover[0][0]);
  }
  while (left.size) {                                           // then greedily cover the rest
    const best = [...primes].filter(([k]) => !chosen.has(k)).sort((x, y) => [...y[1]].filter(m => left.has(m)).length - [...x[1]].filter(m => left.has(m)).length)[0];
    take(best[0]);
  }
  return [...chosen].sort();
}

// Names of the variables an expression uses.
function varsOf(ast, out = new Set()) {
  if (ast.t === 'var') out.add(ast.name);
  else if (ast.t === 'not') varsOf(ast.a, out);
  else if (ast.t === 'op') ast.args.forEach(a => varsOf(a, out));
  return out;
}

// Quine–McCluskey patterns ("1-0") -> expression text using the given variable names.
function sopToExpr(patterns, vars) {
  if (!patterns.length) return '0';
  const terms = patterns.map(p => {
    const lits = [...p].map((c, j) => c === '1' ? vars[j] : c === '0' ? `NOT ${vars[j]}` : null).filter(Boolean);
    return lits.length === 0 ? '1' : lits.length > 1 ? `(${lits.join(' AND ')})` : lits[0];
  });
  if (terms.includes('1')) return '1';
  const s = terms.join(' OR ');
  return terms.length === 1 ? stripParens(s) : s;
}

// Karnaugh map (2–4 variables) as an HTML table. `values[i]` is the output for minterm i (first variable = MSB);
// `patterns` are the chosen prime implicants, each drawn as a coloured outline on the cells it covers.
const KMAP_COLORS = ['#4da3ff', '#ff5c6c', '#ffb347', '#b57bff', '#3ddc84', '#ff7bd5'];
function kmapHtml(vars, values, patterns = []) {
  const n = vars.length;
  if (n < 2 || n > 4) return '';
  const rowN = Math.floor(n / 2), colN = n - rowN;
  const gray = k => k === 0 ? [''] : k === 1 ? ['0', '1'] : ['00', '01', '11', '10'];
  const rows = gray(rowN), cols = gray(colN);
  const head = `<tr><th>${vars.slice(0, rowN).join('')}\\${vars.slice(rowN).join('')}</th>${cols.map(c => `<th>${c}</th>`).join('')}</tr>`;
  const body = rows.map(r => `<tr><th>${r}</th>${cols.map(c => {
    const bits = r + c, idx = parseInt(bits, 2);
    const rings = patterns.map((p, i) => [...p].every((ch, j) => ch === '-' || ch === bits[j]) ? KMAP_COLORS[i % KMAP_COLORS.length] : null).filter(Boolean);
    const shadow = rings.map((col, k) => `inset 0 0 0 ${2 + k * 2}px ${col}`).join(',');
    return `<td class="${values[idx] ? 'one' : ''}"${shadow ? ` style="box-shadow:${shadow}"` : ''}>${values[idx] ? 1 : 0}</td>`;
  }).join('')}</tr>`).join('');
  return `<table class="kmap">${head}${body}</table>`;
}

// For every LED: the expression as built, and (for combinational circuits) the minimized form.
function circuitExpressions() {
  const ins = state.nodes.filter(n => n.type === 'INPUT').sort((a, b) => a.y - b.y || a.x - b.x);
  const outs = state.nodes.filter(n => n.type === 'OUTPUT').sort((a, b) => a.y - b.y || a.x - b.x);
  const result = outs.map(o => {
    const s = exprOfInput(o, 0, new Set([o.id]));
    return { label: o.label, built: s === null ? null : stripParens(s), minimized: null };
  });
  if (!outs.length || result.some(r => r.built === null) || ins.length > 6) return { rows: result, inputs: ins.length, tooMany: ins.length > 6 };
  const table = sweep(ins, () => outs.map(o => val(o.id)));
  result.forEach((r, k) => {
    const minterms = table.map((row, idx) => row[k] ? idx : -1).filter(idx => idx >= 0);
    r.values = table.map(row => !!row[k]);
    if (!minterms.length) { r.minimized = '0'; r.implicants = []; return; }
    if (minterms.length === table.length) { r.minimized = '1'; r.implicants = []; return; }
    r.implicants = minimizeSOP(ins.length, minterms);
    r.minimized = sopToExpr(r.implicants, ins.map(n => n.label));
    r.vars = ins.map(n => n.label);
  });
  return { rows: result, inputs: ins.length };
}
