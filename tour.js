'use strict';
// First-run guided tour: a spotlight on one control at a time with a short explanation.

const TOUR_KEY = 'logic-lab-tour-done';
const TOUR_STEPS = [
  { sel: '#palette', drawer: 'palette', title: '1. Pick parts', text: 'Drag gates, switches, LEDs and chips onto the canvas. Double-click a part to drop it in the middle, or press Enter on it with the keyboard.' },
  { sel: '#stage', title: '2. Wire them up', text: 'Drag from a part’s <b>output dot</b> (right side) to another part’s <b>input dot</b> (left side). Click a switch to flip it and watch the signals flow.' },
  { sel: '#info', drawer: 'info', title: '3. Read the values', text: 'The truth table updates live. Select a gate to see how it behaves, change its number of inputs, or wire it from this panel using only the keyboard.' },
  { sel: '#btn-challenges', title: '4. Try a challenge', text: 'Each challenge sets up switches and LEDs. Build a circuit that matches the target truth table, then press Check.' },
  { sel: '#speed', title: '5. Slow it down', text: 'Switch to <b>Slow-mo</b> or <b>Step by step</b> to watch a signal ripple through one gate delay at a time.' },
  { sel: '#btn-timing', title: '6. See it over time', text: 'The timing diagram records your switches, clock and LEDs as waveforms. It is the best way to understand flip-flops and counters.' },
  { sel: '#demo', title: '7. Let it demonstrate', text: '<b>Demo</b> steps through every switch combination of your circuit and fills in a truth table as it goes.' },
  { sel: '#btn-expr', title: '8. Expressions', text: 'Type <code>Y = A AND NOT B</code> to build a circuit, or read your circuit back as a simplified expression.' },
];

let tourIndex = -1, tourEls = null;

function tourBuild() {
  if (tourEls) return tourEls;
  const hl = document.createElement('div');
  hl.id = 'tour-hl';
  const card = document.createElement('div');
  card.id = 'tour-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'tour-title');
  card.innerHTML = '<h3 id="tour-title"></h3><p id="tour-text"></p><div class="row"><button id="tour-back">Back</button><button id="tour-next" class="primary">Next</button><button id="tour-skip">Skip tour</button></div><div class="hint" id="tour-count"></div>';
  document.body.append(hl, card);
  card.querySelector('#tour-back').addEventListener('click', () => tourShow(tourIndex - 1));
  card.querySelector('#tour-next').addEventListener('click', () => tourShow(tourIndex + 1));
  card.querySelector('#tour-skip').addEventListener('click', tourEnd);
  document.addEventListener('keydown', e => {
    if (tourIndex < 0) return;
    if (e.key === 'Escape') tourEnd();
    else if (e.key === 'ArrowRight') tourShow(tourIndex + 1);
    else if (e.key === 'ArrowLeft') tourShow(tourIndex - 1);
  });
  window.addEventListener('resize', () => { if (tourIndex >= 0) tourShow(tourIndex); });
  tourEls = { hl, card };
  return tourEls;
}

function tourShow(i) {
  if (i < 0) i = 0;
  if (i >= TOUR_STEPS.length) return tourEnd();
  const { hl, card } = tourBuild();
  tourIndex = i;
  const step = TOUR_STEPS[i];
  document.body.classList.remove('show-palette', 'show-info');      // narrow screens keep these panels in drawers
  if (step.drawer) document.body.classList.add('show-' + step.drawer);

  card.querySelector('#tour-title').textContent = step.title;
  card.querySelector('#tour-text').innerHTML = step.text;
  card.querySelector('#tour-count').textContent = `${i + 1} of ${TOUR_STEPS.length}`;
  card.querySelector('#tour-back').disabled = i === 0;
  card.querySelector('#tour-next').textContent = i === TOUR_STEPS.length - 1 ? 'Done' : 'Next';
  hl.style.display = card.style.display = 'block';

  const target = document.querySelector(step.sel), pad = 6;
  const r = target.getBoundingClientRect();
  Object.assign(hl.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + 2 * pad + 'px', height: r.height + 2 * pad + 'px' });
  const cw = card.offsetWidth, ch = card.offsetHeight;
  const big = r.height > window.innerHeight * 0.6;                    // a tall panel: put the card beside it, not under it
  let left = big ? (r.left < window.innerWidth / 2 ? r.right + 14 : r.left - cw - 14) : r.left;
  let top = big ? Math.max(70, r.top + 20) : (r.bottom + 14 + ch < window.innerHeight ? r.bottom + 14 : Math.max(10, r.top - ch - 14));
  if (big && (left < 8 || left + cw > window.innerWidth - 8)) { left = (window.innerWidth - cw) / 2; top = window.innerHeight - ch - 20; }
  card.style.left = Math.min(Math.max(8, left), window.innerWidth - cw - 8) + 'px';
  card.style.top = Math.min(Math.max(8, top), window.innerHeight - ch - 8) + 'px';
  card.querySelector('#tour-next').focus();
}

function tourEnd() {
  tourIndex = -1;
  if (tourEls) tourEls.hl.style.display = tourEls.card.style.display = 'none';
  document.body.classList.remove('show-palette', 'show-info');
  try { localStorage.setItem(TOUR_KEY, '1'); } catch { /* ignore */ }
}

const startTour = () => tourShow(0);
function maybeStartTour() {
  try { if (localStorage.getItem(TOUR_KEY)) return; } catch { return; }
  startTour();
}
