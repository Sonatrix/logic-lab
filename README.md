# Logic Lab

Interactive digital-logic playground for learning. Plain HTML/CSS/JS: no dependencies, no build step.

## Run

Open `index.html` in a browser (or `npx serve .`).

## What's new in 1.1

- **📘 Lessons**: six short guided lessons (signals, gates, adders, latches, flip-flops, counting). Each step loads a circuit and asks you to *predict* an output; the answer is computed by simulating the circuit, then **Show me** plays it out.
- **Sequential challenges**: build a latch, a toggle flip-flop, a 2-bit counter, a 1-0-1 pattern detector. The checker applies scripted switch changes and clock pulses and explains the first step that goes wrong.
- **Challenge authoring** (Tools → *Create a challenge*): your circuit becomes the target; share it as a link. **Progress** can be exported and imported as a file.
- **Karnaugh maps** in the Expressions dialog (2–4 variables), with the prime implicants outlined.
- **Propagation delay**: give a gate a delay (info panel) and use Slow-mo or Step mode to see **glitches** (hazards) in the timing diagram. The *Static hazard* example shows one.
- **State machine designer** (Tools): type a transition table, get a state diagram, minimized equations, and a circuit of D flip-flops with a clock.
- **Verilog export / import** (Tools): gates, constants, flip-flops, latches, mux and decoder export; gate primitives and `assign` statements import.
- **More parts**: D latch, 4-bit shift register, counter, adder and ALU; **number input / display** parts (hex + decimal, 4 or 8 bits); text **notes**.
- **Open a block** (double-click it) to watch the circuit inside it work, read-only.
- **Tidy layout** (auto-arrange), **palette search** (press `/`), **pause** (Space), and a **presentation mode**.

## Learning features

- **🎯 Challenges**: 12 guided problems (inverter → full adder → comparator). The app sets up labelled switches/LEDs; you build the circuit and press Check. Some restrict you to certain gates (e.g. "XOR from AND/OR/NOT", "AND from NANDs").
- **ƒ Expressions**: type `SUM = A XOR B XOR CIN` and get a laid-out circuit, or read your circuit back as expressions plus a minimal sum-of-products (Quine–McCluskey).
- **Speed**: Instant, Slow-mo, or Step by step. Signals ripple one gate delay at a time and changing parts glow orange.
- **〰 Timing**: waveform diagram of switches, clock, buttons and LEDs.
- **▶ Demo**: steps the switches through every combination of *your* circuit (one flips at a time) and narrates which parts output 1.
- **Flow animation**: dashes travel along wires carrying a 1.
- Hover a wire or pin for its live value; double-click a wire to name the signal; unconnected inputs are marked in orange.

## Parts

Switch, push button (momentary), clock (0.25–4 Hz), LED, constant 0/1, 7-segment display;
AND, OR, NOT, BUFFER, NAND, NOR, XOR, XNOR (2–8 inputs on the multi-input ones);
D / T / JK flip-flops, 4-bit register, 2:1 mux, 2→4 decoder, hex→7-segment decoder.
Flip-flops are edge-triggered with proper "everyone samples the old value" semantics, so shift registers and synchronous counters work.

## Building

- Drag parts from the palette (or double-click them). Drag from an output dot to an input dot to wire; drag off an input dot to re-route.
- Click a wire to select it (✕ or Del removes it). Shift-drag or **⬚ Select** box-selects; Ctrl+C / V / D copy, paste, duplicate.
- **📦 Save block**: select a sub-circuit (its switches become the block's inputs, its LEDs the outputs) and reuse it as a part. Blocks nest.
- Undo/redo, zoom (wheel, buttons, pinch), pan, light/dark theme, autosave.
- **Export / Import** JSON (validated, bundles any blocks used) and **🔗 Share** (the whole circuit encoded in the URL).

## Accessibility

- Everything has a keyboard path: focus the canvas, then `]` / `[` pick a part, arrow keys move it (Shift = bigger steps), Enter flips a switch.
- Wiring without a mouse: select a part and use the **Wiring** menus in the info panel (one menu per input pin).
- Palette items are focusable buttons (Enter places the part). Changes are announced through an ARIA live region.
- Live wires are thicker as well as green; `prefers-reduced-motion` stops the flow animation.

## Deploying

It is a static site: upload the folder to any static host (GitHub Pages, Netlify, Cloudflare Pages, S3 + CDN).

- `_headers` contains a strict Content-Security-Policy and other security headers (Netlify / Cloudflare Pages format). On other hosts, set the same headers in the server config. The CSP is a header rather than a `<meta>` tag so that opening `index.html` straight from disk keeps working.
- `sw.js` + `manifest.webmanifest` make it work offline and installable over HTTPS. Bump `CACHE` in `sw.js` when you add files.
- Saved circuits carry a schema version (`SCHEMA_VERSION` in `model.js`). Bump it only for incompatible format changes; older files keep loading.

## Privacy

Logic Lab has no server, accounts or analytics. Your circuits, custom blocks, theme and progress are stored only in your browser's local storage. A share link contains the whole circuit inside the URL and is never sent anywhere by the app.

## Tests

```
npm test                 # syntax check + logic tests + browser tests
npm run test:logic       # simulation, expressions, minimization, blocks, import validation, challenges (node only)
npm run test:browser     # drives the real UI in headless Chrome/Edge
```

The browser tests need a Chromium-based browser; set `CHROME_BIN` if it is not auto-detected. They cover drag-to-wire, box select, slow-mo, timing, dialogs, keyboard and menu wiring, the tour, image export, error handling and the narrow-screen layout. CI runs `npm test` on every push (`.github/workflows/ci.yml`).

## Not included

- **Tri-state / open-collector outputs and true multi-bit bus wires** would need a shared-net model (several drivers on one wire). The wiring here is one driver per input, so buses are provided as number input/display parts and wide chips instead.

## Known limits

- Developed and tested in Chromium (Edge). Firefox and Safari, and real touch devices (pinch-zoom, tap-to-place), have not been tested yet.
- Challenge authoring supports combinational circuits only. Gate delays apply in Slow-mo / Step modes; instant mode ignores them.
- Blocks cannot contain a clock or button, and run as a single instant step in slow-motion mode.

## Layout

| File | Role |
| --- | --- |
| `parts.js` | gate / chip catalogue and geometry |
| `model.js` | state, simulation engine, block library, validation, import/export |
| `expr.js` | expression parser, circuit builder, circuit → expression, minimizer |
| `challenges.js` | challenge definitions and checker |
| `layout.js` | auto-arrange (tidy) |
| `netlist.js` | Verilog export / import |
| `fsm.js` | state machine designer |
| `lessons.js` | lesson content and answer checking |
| `timing.js` | timing diagram |
| `imageexport.js` | PNG / SVG export |
| `tour.js` | first-run guided tour |
| `app.js` | rendering, interaction, panels, dialogs |
| `tools.js` | search, lessons, FSM, Verilog, authoring, block viewer; starts the app |
| `sw.js`, `manifest.webmanifest`, `_headers` | offline support, install metadata, security headers |
