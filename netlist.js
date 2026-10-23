'use strict';
// Verilog export (current circuit) and import (gate primitives + simple assigns). No DOM access.

const V_GATES = { AND: 'and', OR: 'or', NAND: 'nand', NOR: 'nor', XOR: 'xor', XNOR: 'xnor', NOT: 'not', BUFFER: 'buf' };

const vIdent = (s, taken) => {
  let id = String(s).replace(/[^A-Za-z0-9_]/g, '_');
  if (!/^[A-Za-z_]/.test(id)) id = 'n' + id;
  const base = id;
  for (let k = 2; taken.has(id); k++) id = `${base}_${k}`;
  taken.add(id);
  return id;
};

// Returns { text, unsupported: [...] }. Combinational gates, constants and the simple flip-flops/latches/mux are
// translated; other parts are listed in a comment and their outputs left undriven (1'bx).
function toVerilog(moduleName = 'logic_lab_circuit') {
  const taken = new Set(['clk']), unsupported = [];
  const wire = new Map(), decl = [], body = [], inPorts = [], outPorts = [];
  const net = (id, k) => wire.get(id + ':' + k) || "1'bx";
  const src = (n, i) => { const w = state.wires.find(w => w.to === n.id && w.port === i); return w ? net(w.from, w.fp || 0) : "1'b0"; };

  for (const n of state.nodes) {                                    // ports and net names first
    if (n.type === 'INPUT' || n.type === 'BUTTON') { const id = vIdent(n.label, taken); wire.set(n.id + ':0', id); inPorts.push(id); }
    else if (n.type === 'CLOCK') { wire.set(n.id + ':0', 'clk'); if (!inPorts.includes('clk')) inPorts.push('clk'); }
    else geom(n).outs.forEach((_, k) => { const id = vIdent(`n${n.id}_${k}`, taken); wire.set(n.id + ':' + k, id); });
  }
  for (const n of state.nodes) {
    const w0 = wire.get(n.id + ':0'), w1 = wire.get(n.id + ':1');
    const ins = geom(n).ins.map((_, i) => src(n, i));
    switch (n.type) {
      case 'INPUT': case 'BUTTON': case 'CLOCK': case 'NOTE': case 'SEG7': break;
      case 'HIGH': decl.push(`wire ${w0};`); body.push(`assign ${w0} = 1'b1;`); break;
      case 'LOW': decl.push(`wire ${w0};`); body.push(`assign ${w0} = 1'b0;`); break;
      case 'OUTPUT': { const id = vIdent(n.label, taken); outPorts.push(id); body.push(`assign ${id} = ${ins[0]};`); break; }
      case 'DFF': case 'TFF': case 'JKFF': {
        decl.push(`reg ${w0} = 1'b0;`, `wire ${w1};`);
        const clk = ins[n.type === 'JKFF' ? 2 : 1];
        const act = n.type === 'DFF' ? `${w0} <= ${ins[0]};`
          : n.type === 'TFF' ? `if (${ins[0]}) ${w0} <= ~${w0};`
          : `case ({${ins[0]}, ${ins[1]}}) 2'b01: ${w0} <= 1'b0; 2'b10: ${w0} <= 1'b1; 2'b11: ${w0} <= ~${w0}; default: ; endcase`;
        body.push(`always @(posedge ${clk}) ${act}`, `assign ${w1} = ~${w0};`);
        break;
      }
      case 'DLATCH':
        decl.push(`reg ${w0} = 1'b0;`, `wire ${w1};`);
        body.push(`always @* if (${ins[1]}) ${w0} = ${ins[0]};`, `assign ${w1} = ~${w0};`);
        break;
      case 'MUX2': decl.push(`wire ${w0};`); body.push(`assign ${w0} = ${ins[2]} ? ${ins[1]} : ${ins[0]};`); break;
      case 'DEC24':
        geom(n).outs.forEach((_, k) => { decl.push(`wire ${wire.get(n.id + ':' + k)};`); body.push(`assign ${wire.get(n.id + ':' + k)} = ({${ins[1]}, ${ins[0]}} == 2'd${k});`); });
        break;
      default:
        if (V_GATES[n.type]) {
          decl.push(`wire ${w0};`);
          body.push(`${V_GATES[n.type]} g${n.id} (${w0}, ${ins.join(', ')});`);
        } else {
          unsupported.push(`${n.type === 'BLOCK' ? 'block ' + n.block : n.type} #${n.id}`);
          geom(n).outs.forEach((_, k) => decl.push(`wire ${wire.get(n.id + ':' + k)} = 1'bx;  // unsupported part`));
        }
    }
  }
  const ports = [...inPorts.map(p => `input ${p}`), ...outPorts.map(p => `output ${p}`)];
  const text = `// Exported from Logic Lab\n` + (unsupported.length ? `// NOT translated (outputs are undriven): ${unsupported.join(', ')}\n` : '') +
    `module ${moduleName}(${ports.join(', ')});\n${[...decl, ...body].map(l => '  ' + l).join('\n')}\nendmodule\n`;
  return { text, unsupported };
}

// Parse the supported Verilog subset into the expression lines used by buildCircuit.
// Returns { lines: [{name, ast}], outputs: Set }. Throws Error with a readable message.
function parseVerilog(text) {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, ' ');
  const safe = n => KEYWORDS[n.toUpperCase()] ? n + '_' : n;
  const defs = new Map(), outputs = new Set();
  const define = (name, ast) => { if (defs.has(name)) throw new Error(`"${name}" is driven twice`); defs.set(name, ast); };
  const call = (op, args) => ({ t: 'op', op, args });
  const v = name => ({ t: 'var', name: safe(name) });
  const NOT = a => ({ t: 'not', a });

  const stmts = src.split(';').map(s => s.trim()).filter(Boolean);
  for (let st of stmts) {
    let m;
    st = st.replace(/^wire\s+(\w+)\s*=/, 'assign $1 =');            // "wire w = a & b" is a declaration plus an assign
    if (/^module\b/.test(st)) {
      const ports = /\(([\s\S]*)\)/.exec(st);                       // ANSI-style "module m(input a, output y)"
      if (ports) for (const p of ports[1].split(',')) { const o = /^\s*output\s+(?:wire\s+|reg\s+)?(\w+)\s*$/.exec(p); if (o) outputs.add(safe(o[1])); }
      continue;
    }
    if (st === 'endmodule') continue;
    if ((m = /^(input|output|wire|reg)\b([\s\S]*)$/.exec(st))) {
      if (/\[/.test(m[2])) throw new Error('Vectors (buses) are not supported: ' + st.slice(0, 40));
      if (m[1] === 'output') m[2].split(',').forEach(n => { const id = n.trim().split(/\s+/).pop(); if (id) outputs.add(safe(id)); });
      continue;
    }
    if ((m = /^(and|or|nand|nor|xor|xnor|not|buf)\s*(?:\w+\s*)?\(([\s\S]*)\)$/.exec(st))) {
      const p = m[2].split(',').map(s => s.trim());
      if (p.length < 2) throw new Error('Gate needs an output and at least one input: ' + st.slice(0, 40));
      const [o, ...ins] = p, a = ins.map(s => parseOperand(s, safe));
      const base = { and: 'AND', nand: 'AND', or: 'OR', nor: 'OR', xor: 'XOR', xnor: 'XOR' }[m[1]];
      let ast;
      if (m[1] === 'not') { if (a.length !== 1) throw new Error('"not" takes one input'); ast = NOT(a[0]); }
      else if (m[1] === 'buf') { if (a.length !== 1) throw new Error('"buf" takes one input'); ast = a[0]; }
      else { if (a.length < 2) throw new Error(`"${m[1]}" needs at least two inputs`); ast = call(base, a); if (/^(nand|nor|xnor)$/.test(m[1])) ast = NOT(ast); }
      define(safe(o), ast);
      continue;
    }
    if ((m = /^assign\s+(\w+)\s*=\s*([\s\S]+)$/.exec(st))) {
      const rhs = m[2].replace(/\b1'b([01])\b/g, '$1').replace(/&&/g, '&').replace(/\|\|/g, '|').replace(/\b[A-Za-z_]\w*\b/g, safe);
      define(safe(m[1]), parseExpr(rhs));
      continue;
    }
    throw new Error('Unsupported Verilog: ' + st.replace(/\s+/g, ' ').slice(0, 60));
  }
  if (!defs.size) throw new Error('No gates or assigns found.');

  // order so every net is defined before it is used; a cycle means a combinational loop
  const names = [...defs.keys()], emitted = new Set(), lines = [];
  while (lines.length < names.length) {
    const next = names.find(n => !emitted.has(n) && [...varsOf(defs.get(n))].every(x => !defs.has(x) || emitted.has(x)));
    if (!next) throw new Error('Combinational loop in the netlist (feedback is not supported on import).');
    emitted.add(next); lines.push({ name: next, ast: defs.get(next) });
  }
  if (!outputs.size) {                                              // no declaration: nets nobody reads are the outputs
    const used = new Set(lines.flatMap(l => [...varsOf(l.ast)]));
    names.filter(n => !used.has(n)).forEach(n => outputs.add(n));
  }
  return { lines, outputs };
}

function parseOperand(s, safe) {
  const c = /^1'b([01])$/.exec(s);
  if (c) return { t: 'const', v: c[1] === '1' };
  if (!/^[A-Za-z_]\w*$/.test(s)) throw new Error(`Unsupported operand "${s}"`);
  return { t: 'var', name: safe(s) };
}

function circuitFromVerilog(text) {
  const { lines, outputs } = parseVerilog(text);
  return buildCircuit(lines, { ledFor: outputs });
}
