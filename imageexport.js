'use strict';
// Export the circuit as SVG / PNG and the timing diagram as PNG, for slides and worksheets.

const SVG_STYLE_PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin',
  'font-size', 'font-weight', 'font-family', 'text-anchor', 'paint-order', 'opacity'];

// A standalone SVG string of the current circuit (computed styles are inlined so it renders anywhere), or null.
function circuitSvg() {
  const canvas = document.getElementById('canvas');
  if (!state.nodes.length) return null;
  const group = canvas.firstElementChild;
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const n of state.nodes) {
    const g = geom(n);
    b.x0 = Math.min(b.x0, n.x); b.y0 = Math.min(b.y0, n.y - 18); b.x1 = Math.max(b.x1, n.x + g.w); b.y1 = Math.max(b.y1, n.y + g.h);
  }
  const pad = 24, x = b.x0 - pad, y = b.y0 - pad, w = Math.ceil(b.x1 - b.x0 + 2 * pad), h = Math.ceil(b.y1 - b.y0 + 2 * pad);

  const clone = group.cloneNode(true);
  const from = group.querySelectorAll('*'), to = clone.querySelectorAll('*');
  from.forEach((el, i) => {
    const cs = getComputedStyle(el);
    for (const p of SVG_STYLE_PROPS) { const v = cs.getPropertyValue(p); if (v) to[i].style.setProperty(p, v); }
  });
  clone.querySelectorAll('.hit, .wire-x, .selbox, .temp, title').forEach(el => el.remove());
  clone.removeAttribute('transform');

  const bg = getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#12151c';
  const root = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  root.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  root.setAttribute('width', w); root.setAttribute('height', h);
  const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  for (const [k, v] of Object.entries({ x, y, width: w, height: h, fill: bg })) bgRect.setAttribute(k, v);
  root.append(bgRect, clone);
  return { text: new XMLSerializer().serializeToString(root), w, h };
}

async function svgToPngBlob({ text, w, h }, scale = 2) {
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = () => reject(new Error('image failed to load')); img.src = url; });
    const c = document.createElement('canvas');
    c.width = w * scale; c.height = h * scale;
    const ctx = c.getContext('2d');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise(resolve => c.toBlob(resolve, 'image/png'));
  } finally { URL.revokeObjectURL(url); }
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

document.getElementById('btn-image').addEventListener('click', () => document.getElementById('dlg-image').showModal());
document.getElementById('img-svg').addEventListener('click', () => {
  const s = circuitSvg();
  if (!s) return toast('Nothing to export yet.');
  downloadBlob(new Blob([s.text], { type: 'image/svg+xml' }), 'circuit.svg');
});
document.getElementById('img-png').addEventListener('click', async () => {
  const s = circuitSvg();
  if (!s) return toast('Nothing to export yet.');
  try { downloadBlob(await svgToPngBlob(s), 'circuit.png'); }
  catch { toast('Could not render the PNG in this browser. Try the SVG export.'); }
});
document.getElementById('img-timing').addEventListener('click', () => {
  if (!timing.visible) return toast('Open the 〰 Timing panel first, then export it.');
  drawTiming();
  document.getElementById('timing-canvas').toBlob(b => downloadBlob(b, 'timing.png'));
});
