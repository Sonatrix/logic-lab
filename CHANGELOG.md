# Changelog

## 1.1.0
- Lessons with computed prediction quizzes; sequential challenges; challenge authoring and progress export
- Karnaugh maps; per-gate propagation delay with hazard demo; state machine designer; Verilog export/import
- New parts: D latch, shift register, counter, 4-bit adder and ALU, number input/display, notes
- Block viewer, tidy layout, palette search, pause, presentation mode
- An example that forces Slow-mo restores your previous speed when you leave it
- Tests: 125 logic checks, 108 browser checks

## 1.0.0
- Gates, flip-flops (D/T/JK), register, mux, decoders, 7-segment display, clock, button, constants
- Challenges, expression ↔ circuit (with Quine–McCluskey minimization), slow-motion propagation, timing diagram, demo with live truth table
- Reusable blocks, copy/paste, multi-select, undo/redo, zoom/pan/pinch, light/dark theme
- Export/import JSON, share links, PNG/SVG image export
- Guided first-run tour; responsive layout with drawers on narrow screens
- Accessibility: keyboard navigation, menu-based wiring, screen-reader announcements, reduced-motion support, non-colour on/off cue
- Offline support (service worker) and installable manifest; security headers in `_headers`
- Saved-file schema version (v3); newer files are rejected with a clear message, older ones still load
- Autosave failure and unreadable-save recovery (backup kept) reported to the user
- CI: `npm test` (syntax check, 40 logic checks, 66 browser checks)
