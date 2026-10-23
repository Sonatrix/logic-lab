'use strict';
// Timing diagram: records every change of the switches, clock, buttons and LEDs and draws them as waveforms.

const timing = { hist: [], visible: false, windowMs: 10000, timer: null };
const watched = () => state.nodes.filter(n => ['INPUT', 'CLOCK', 'BUTTON', 'OUTPUT'].includes(n.type)).sort((a, b) => a.y - b.y || a.x - b.x);

function sampleSignals() {
  const sigs = watched(), v = {};
  sigs.forEach(n => { v[n.id] = val(n.id); });
  const last = timing.hist[timing.hist.length - 1];
  if (last && sigs.every(n => last.v[n.id] === v[n.id])) return;
  timing.hist.push({ t: performance.now(), v });
  if (timing.hist.length > 3000) timing.hist.shift();
}

function drawTiming() {
  if (!timing.visible) return;
  const canvas = document.getElementById('timing-canvas');
  const sigs = watched(), rowH = 28, left = 74, top = 6;
  const W = canvas.clientWidth, H = top + Math.max(1, sigs.length) * rowH + 22, dpr = window.devicePixelRatio || 1;
  canvas.style.height = H + 'px';
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const css = getComputedStyle(document.body);
  const on = css.getPropertyValue('--on').trim(), dim = css.getPropertyValue('--dim').trim(), grid = css.getPropertyValue('--line').trim(), text = css.getPropertyValue('--text').trim();
  const now = performance.now(), t0 = now - timing.windowMs, right = W - 10;
  const xOf = t => left + (t - t0) / timing.windowMs * (right - left);

  ctx.font = '12px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = grid; ctx.fillStyle = dim; ctx.lineWidth = 1;
  for (let s = 0; s <= timing.windowMs / 1000; s++) {          // one gridline per second, labelled "now − s"
    const x = xOf(now - s * 1000);
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, H - 18); ctx.stroke();
    if (s % 2 === 0) ctx.fillText(s === 0 ? 'now' : `-${s}s`, x - 10, H - 8);
  }
  const hist = timing.hist;
  sigs.forEach((n, r) => {
    const y0 = top + r * rowH, hi = y0 + 5, lo = y0 + rowH - 8, yOf = v => v ? hi : lo;
    ctx.fillStyle = text; ctx.fillText(n.label, 8, y0 + rowH / 2 - 2);
    let cur = false;
    for (const e of hist) { if (e.t <= t0) cur = !!e.v[n.id]; else break; }
    ctx.strokeStyle = on; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(left, yOf(cur));
    for (const e of hist) {
      if (e.t <= t0) continue;
      const v = !!e.v[n.id];
      if (v !== cur) { const x = xOf(e.t); ctx.lineTo(x, yOf(cur)); ctx.lineTo(x, yOf(v)); cur = v; }
    }
    ctx.lineTo(right, yOf(cur)); ctx.stroke();
  });
}

function showTiming(on) {
  timing.visible = on;
  document.getElementById('timing').hidden = !on;
  clearInterval(timing.timer);
  if (on) { sampleSignals(); drawTiming(); timing.timer = setInterval(drawTiming, 100); }
}
