'use strict';
// UI for the extra tools: search, tidy, presentation, pause, progress, lessons, FSM, Verilog, authoring, block viewer.
// Loaded after app.js; it ends by starting the app.

// ---------------------------------------------------------------- palette search
function filterPalette(q) {
  q = (q || '').trim().toLowerCase();
  let any = false;
  document.querySelectorAll('#palette .group').forEach(group => {
    let visible = 0;
    group.querySelectorAll('.item').forEach(it => {
      const hit = !q || `${it.dataset.type} ${it.textContent}`.toLowerCase().includes(q);
      it.hidden = !hit;
      if (hit) visible++;
    });
    group.hidden = !!q && !visible;
    const head = group.previousElementSibling;
    if (head && head.tagName === 'H2') head.hidden = group.hidden;
    any = any || visible > 0;
  });
  $('#palette-none').hidden = any || !q;
}
$('#palette-search').addEventListener('input', e => filterPalette(e.target.value));
$('#palette-search').addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.target.value = ''; filterPalette(''); e.target.blur(); }
  if (e.key === 'Enter') { const first = document.querySelector('#palette .item:not([hidden])'); if (first) placeFromPalette(first.dataset.type); }   // type a name, press Enter
});
document.addEventListener('keydown', e => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || (e.target !== document.body && e.target !== svg)) return;
  e.preventDefault();
  if (narrowScreen()) { closeDrawers(); document.body.classList.add('show-palette'); }
  $('#palette-search').focus();
});

// ---------------------------------------------------------------- tidy layout
function tidyLayout() {
  if (!state.nodes.length) return toast('Nothing to arrange yet.');
  record();
  const pos = autoLayout(state.nodes, state.wires);
  for (const n of state.nodes) { const p = pos.get(n.id); if (p) { n.x = snap(p.x); n.y = snap(p.y); } }
  fitView();
  changed();
  toast('Arranged left to right. Press Ctrl+Z to undo.');
}

// ---------------------------------------------------------------- presentation mode and pause
function setPresent(on) {
  document.body.classList.toggle('present', on);
  $('#present-exit').hidden = !on;
  closeDrawers();
  if (on && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => { /* fullscreen is optional */ });
  if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => { /* ignore */ });
  requestAnimationFrame(() => { fitView(on ? 2.2 : 1); render(); });
}
$('#present-exit').addEventListener('click', () => setPresent(false));
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && document.body.classList.contains('present')) setPresent(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('present')) setPresent(false); });

function togglePause() {
  paused = !paused;
  document.body.classList.toggle('paused', paused);
  $('#pause').setAttribute('aria-pressed', paused);
  $('#pause').textContent = paused ? '▶ Resume' : '⏸ Pause';
  announce(paused ? 'Paused. Clocks and the demo are frozen.' : 'Resumed.');
}
$('#pause').addEventListener('click', togglePause);

// ---------------------------------------------------------------- progress
function downloadText(text, name, type = 'application/json') { downloadBlob(new Blob([text], { type }), name); }
$('#progress-file').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  let added = null;
  try { added = mergeProgress(JSON.parse(await f.text())); } catch { /* handled below */ }
  toast(added === null ? 'That is not a Logic Lab progress file.' : added ? `Imported progress: ${added} new item${added === 1 ? '' : 's'}.` : 'Nothing new in that progress file.');
});

// ---------------------------------------------------------------- lessons
let lessonIdx = -1, lessonStep = 0, lessonLoaded = null, lessonAnswered = {};
const lessonDlg = $('#dlg-lessons');
lessonDlg.classList.add('floating');

function renderLessonList() {
  const done = lessonsDone();
  $('#lesson-body').hidden = true;
  $('#lesson-list').hidden = false;
  $('#lesson-list').innerHTML = LESSONS.map((l, i) => `<button class="lesson-item" data-i="${i}"><div><div class="t">${esc(l.title)}</div><div class="d">${l.steps.length} step${l.steps.length === 1 ? '' : 's'}</div></div>${done.has(l.id) ? '<span class="check">✓</span>' : ''}</button>`).join('');
}
function openLessons() {
  renderLessonList();
  if (!lessonDlg.open) lessonDlg.show();                      // non-modal, so the circuit stays clickable
}
function showLessonStep() {
  const l = LESSONS[lessonIdx], st = l.steps[lessonStep];
  $('#lesson-list').hidden = true; $('#lesson-body').hidden = false;
  $('#lesson-name').textContent = l.title;
  $('#lesson-count').textContent = `Step ${lessonStep + 1} of ${l.steps.length}`;
  $('#lesson-text').innerHTML = st.html;
  const spec = lessonSpec(l, lessonStep);
  if (spec && spec !== lessonLoaded) { loadSpec(spec); lessonLoaded = spec; }
  const q = $('#lesson-quiz');
  q.innerHTML = '';
  if (st.quiz && spec) {
    const key = `${lessonIdx}:${lessonStep}`, answer = lessonAnswer(spec, st.quiz.predict), prev = lessonAnswered[key];
    q.innerHTML = `<div class="quiz"><div><b>Predict:</b> ${esc(st.quiz.q)}</div><div class="opts"><button data-a="0">0</button><button data-a="1">1</button></div><div class="res" id="quiz-res"></div></div>`;
    const show = pick => {
      const ok = pick === answer;
      $('#quiz-res').innerHTML = (ok ? '<span class="ok">✅ Correct!</span>' : `<span class="bad">❌ Not quite. The answer is ${answer}.</span>`) + ' <button id="quiz-show">▶ Show me</button>';
      q.querySelectorAll('[data-a]').forEach(b => { b.disabled = true; });
    };
    if (prev !== undefined) show(prev);
    q.onclick = e => {
      const b = e.target.closest('[data-a]');
      if (b && !b.disabled) { lessonAnswered[key] = +b.dataset.a; show(+b.dataset.a); }
      if (e.target.id === 'quiz-show') playPrediction(spec, st.quiz.predict);
    };
  }
  $('#lesson-prev').disabled = lessonStep === 0;
  $('#lesson-next').textContent = lessonStep === l.steps.length - 1 ? 'Finish ✓' : 'Next';
}
// Demonstrate the prediction on the live circuit, one step at a time.
async function playPrediction(spec, predict) {
  loadSpec(spec); lessonLoaded = spec;
  const steps = predict.steps || [{ set: predict.set }];
  for (const st of steps) {
    await new Promise(r => setTimeout(r, 700));
    applyStepOnce(st, () => changed(true));
  }
}
$('#lesson-list').addEventListener('click', e => {
  const b = e.target.closest('.lesson-item');
  if (!b) return;
  lessonIdx = +b.dataset.i; lessonStep = 0; lessonLoaded = null; lessonAnswered = {};
  showLessonStep();
});
$('#lesson-back').addEventListener('click', renderLessonList);
$('#lesson-prev').addEventListener('click', () => { if (lessonStep > 0) { lessonStep--; showLessonStep(); } });
$('#lesson-next').addEventListener('click', () => {
  const l = LESSONS[lessonIdx];
  if (lessonStep < l.steps.length - 1) { lessonStep++; showLessonStep(); return; }
  markLessonDone(l.id);
  toast(`Lesson complete: ${l.title}`);
  renderLessonList();
});
$('#btn-lessons').addEventListener('click', openLessons);

// ---------------------------------------------------------------- state machine designer
for (const name of Object.keys(FSM_EXAMPLES)) $('#fsm-example').add(new Option(name, name));
$('#fsm-text').value = FSM_EXAMPLES[Object.keys(FSM_EXAMPLES)[0]];
$('#fsm-example').addEventListener('change', e => { $('#fsm-text').value = FSM_EXAMPLES[e.target.value]; previewFsm(); });

function previewFsm() {
  const err = $('#fsm-err'), out = $('#fsm-out');
  err.textContent = ''; out.innerHTML = '';
  try {
    const f = parseFsm($('#fsm-text').value), eq = fsmEquations(f);
    out.innerHTML = fsmDiagramSvg(f) +
      `<div class="eq">${esc(`${f.states.length} states → ${eq.k} flip-flop${eq.k === 1 ? '' : 's'} (${eq.qNames.join(', ')}); reset state ${f.states[0]} = all 0\n` + eq.equations.map(e => e.text).join('\n'))}</div>` +
      (eq.warnings.length ? `<div class="warn" style="font-size:12px;margin-top:6px">${eq.warnings.map(esc).join('<br>')}</div>` : '');
    return f;
  } catch (e) { err.textContent = e.message; return null; }
}
$('#fsm-preview').addEventListener('click', previewFsm);
$('#fsm-build').addEventListener('click', () => {
  const f = previewFsm();
  if (!f) return;
  try { adopt(buildFsmCircuit(f), null); $('#dlg-fsm').close(); toast('Built. Flip the input switches and watch the clock step the machine.'); }
  catch (e) { $('#fsm-err').textContent = e.message; }
});

// ---------------------------------------------------------------- Verilog
$('#verilog-export').addEventListener('click', () => {
  $('#verilog-err').textContent = '';
  if (!state.nodes.length) { $('#verilog-err').textContent = 'The canvas is empty.'; return; }
  const r = toVerilog();
  $('#verilog-text').value = r.text;
  if (r.unsupported.length) $('#verilog-err').textContent = `Not translated: ${r.unsupported.join(', ')}`;
});
$('#verilog-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('#verilog-text').value); toast('Copied.'); } catch { $('#verilog-text').select(); toast('Press Ctrl+C to copy.'); }
});
$('#verilog-download').addEventListener('click', () => downloadText($('#verilog-text').value, 'circuit.v', 'text/plain'));
$('#verilog-import').addEventListener('click', () => {
  $('#verilog-err').textContent = '';
  try { adopt(circuitFromVerilog($('#verilog-text').value), null); $('#dlg-verilog').close(); toast('Built from Verilog. Use Tools → Tidy layout to arrange it.'); }
  catch (e) { $('#verilog-err').textContent = e.message; }
});

// ---------------------------------------------------------------- challenge authoring
$('#author-gates').innerHTML = Object.keys(GATES).map(g => `<label><input type="checkbox" value="${g}"> ${g}</label>`).join('');
function authorChallenge() {
  const allowed = [...document.querySelectorAll('#author-gates input:checked')].map(i => i.value);
  return captureChallenge({ title: $('#author-title-in').value, desc: $('#author-desc').value, hint: $('#author-hint').value, allowed });
}
$('#author-copy').addEventListener('click', async () => {
  const c = authorChallenge();
  $('#author-err').textContent = c.error || '';
  if (c.error) return;
  const url = location.href.split('#')[0] + '#ch=' + await encodeShare(c);
  const box = $('#author-link');
  box.value = url; box.hidden = false;
  try { await navigator.clipboard.writeText(url); toast('Challenge link copied. Anyone who opens it gets this challenge.'); }
  catch { box.select(); toast('Copy the link from the box.'); }
});
$('#author-try').addEventListener('click', () => {
  const raw = authorChallenge();
  $('#author-err').textContent = raw.error || '';
  const c = !raw.error && makeCustomChallenge(raw);
  if (!c) return;
  $('#dlg-author').close();
  loadChallenge(c);
});

// ---------------------------------------------------------------- read-only view inside a block
let blockViewId = null;
function openBlockView(id) {
  blockViewId = id;
  const d = $('#dlg-block');
  if (!d.open) d.show();
  renderBlockView();
}
function renderBlockView() {
  const d = $('#dlg-block');
  if (!d.open || blockViewId == null) return;
  const n = byId(blockViewId), def = n && BLOCKS.get(n.block);
  if (!def) { d.close(); return; }
  if (!sim.mem[n.id] || !sim.mem[n.id].nodes) evalAll();
  const m = sim.mem[n.id];
  if (!m || !m.nodes) return;
  const keepState = state, keepSim = sim;
  let markup = '';
  state = { nodes: m.nodes, wires: def.wires, nextId: 1, counters: { INPUT: 0, OUTPUT: 0 } };
  sim = { outs: m.outs, mem: m.mem };
  try { markup = circuitMarkup(true); } finally { state = keepState; sim = keepSim; }
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const x of m.nodes) { const g = geom(x); b.x0 = Math.min(b.x0, x.x); b.y0 = Math.min(b.y0, x.y - 18); b.x1 = Math.max(b.x1, x.x + g.w); b.y1 = Math.max(b.y1, x.y + g.h); }
  const pad = 20;
  $('#block-svg').setAttribute('viewBox', `${b.x0 - pad} ${b.y0 - pad} ${b.x1 - b.x0 + 2 * pad} ${b.y1 - b.y0 + 2 * pad}`);
  $('#block-svg').innerHTML = markup;
  $('#block-title').textContent = `Inside “${n.block}”`;
}
$('#dlg-block .close').addEventListener('click', () => { blockViewId = null; });

// ---------------------------------------------------------------- Tools menu
$('#tools').addEventListener('change', e => {
  const v = e.target.value;
  e.target.value = '';
  if (v === 'tidy') tidyLayout();
  else if (v === 'fsm') { previewFsm(); $('#dlg-fsm').showModal(); }
  else if (v === 'verilog') { $('#verilog-err').textContent = ''; $('#dlg-verilog').showModal(); }
  else if (v === 'author') { $('#author-err').textContent = ''; $('#author-link').hidden = true; $('#dlg-author').showModal(); }
  else if (v === 'present') setPresent(true);
  else if (v === 'progress-export') downloadText(JSON.stringify(progressPayload(), null, 2), 'logic-lab-progress.json');
  else if (v === 'progress-import') $('#progress-file').click();
});

boot();
