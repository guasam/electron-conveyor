# electron-conveyor

Type-safe IPC + cross-window state for Electron. API docs in README.md; entry points map 1:1
to processes (`define` pure, `main`, `renderer`, `react`, `preload`).

- When writing or editing any source, follow the house style in
  `.claude/skills/code-style/SKILL.md` — section banner format, comment tone and density.
- Checks: `npm run typecheck && npm test && npm run build`.
- `core/` must stay electron-free (it's the testable part); electron wiring lives in `main/`.
