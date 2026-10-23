'use strict';
// Runs test/browser.test.html in headless Chrome/Edge and fails if any check fails.
// No npm dependencies: it just needs a Chromium-based browser (set CHROME_BIN to choose one).
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const candidates = [
  process.env.CHROME_BIN,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
].filter(Boolean);
const bin = candidates.find(p => fs.existsSync(p));
if (!bin) { console.error('No Chrome/Edge found. Install one or set CHROME_BIN.'); process.exit(2); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'logic-lab-'));
const url = pathToFileURL(path.join(__dirname, 'browser.test.html')).href;
const run = spawnSync(bin, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-sandbox', `--user-data-dir=${profile}`,
  '--allow-file-access-from-files', '--window-size=1500,900', '--virtual-time-budget=40000', '--dump-dom', url,
], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 180000 });
fs.rmSync(profile, { recursive: true, force: true });

const m = /<pre id="out">([\s\S]*?)<\/pre>/.exec(run.stdout || '');
if (!m) { console.error('The test page produced no report.\n', (run.stdout || '').slice(0, 800), run.stderr ? run.stderr.slice(0, 800) : ''); process.exit(1); }
const report = m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
console.log(report);
process.exit(/^FAIL|DRIVER EXCEPTION|IFRAME ERRORS|PAGE ERROR|RESULT: ERRORS/m.test(report) || !/RESULT: no runtime errors/.test(report) ? 1 : 0);
