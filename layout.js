'use strict';
// Automatic tidy-up: arrange parts in columns from sources (left) to sinks (right). No DOM access.

// Returns Map(id -> {x, y}) top-left positions. Feedback wires (back edges) are ignored when ranking columns.
function autoLayout(nodes, wires) {
  const movable = nodes.filter(n => n.type !== 'NOTE');
  const ids = new Set(movable.map(n => n.id));
  const out = new Map(movable.map(n => [n.id, []]));
  const hasIn = new Set();
  for (const w of wires) if (ids.has(w.from) && ids.has(w.to)) { out.get(w.from).push(w.to); hasIn.add(w.to); }

  // depth-first search to order nodes topologically and find feedback (back) edges
  const mark = new Map(), order = [], back = new Set();
  const visit = id => {
    mark.set(id, 1);
    for (const to of out.get(id)) {
      if (mark.get(to) === 1) back.add(id + '>' + to);
      else if (!mark.has(to)) visit(to);
    }
    mark.set(id, 2); order.push(id);
  };
  [...movable.filter(n => !hasIn.has(n.id)), ...movable].forEach(n => { if (!mark.has(n.id)) visit(n.id); });

  const depth = new Map(movable.map(n => [n.id, 0]));
  for (const id of order.reverse()) {
    for (const to of out.get(id)) if (!back.has(id + '>' + to)) depth.set(to, Math.max(depth.get(to), depth.get(id) + 1));
  }

  const byId = new Map(movable.map(n => [n.id, n]));
  const layers = [];
  for (const n of movable) (layers[depth.get(n.id)] = layers[depth.get(n.id)] || []).push(n);
  const incoming = new Map(movable.map(n => [n.id, []]));
  for (const w of wires) if (incoming.has(w.to) && byId.has(w.from) && !back.has(w.from + '>' + w.to)) incoming.get(w.to).push(w.from);

  const pos = new Map(), cy = new Map();
  let x = 30;
  layers.forEach(layer => {
    if (!layer) return;
    const want = n => { const src = incoming.get(n.id).filter(id => cy.has(id)); return src.length ? src.reduce((s, id) => s + cy.get(id), 0) / src.length : null; };
    layer.forEach(n => { n.__want = want(n); });
    layer.sort((a, b) => (a.__want ?? a.y) - (b.__want ?? b.y));     // keep the existing order for source columns
    let cursor = 30, widest = 0;
    for (const n of layer) {
      const g = geom(n), top = Math.max(cursor, (n.__want ?? cursor + g.h / 2) - g.h / 2);
      pos.set(n.id, { x, y: top });
      cy.set(n.id, top + g.h / 2);
      cursor = top + g.h + 30;
      widest = Math.max(widest, g.w);
      delete n.__want;
    }
    x += widest + 80;
  });
  return pos;
}
