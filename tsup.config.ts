import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    define: 'src/define.ts',
    main: 'src/main.ts',
    renderer: 'src/renderer.ts',
    preload: 'src/preload.ts',
  },
  // Dual format: renderer is bundled as ESM, but Electron's main process is CJS by default.
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  // Peers are provided by the consuming app — never bundle them (single React/zustand instance).
  external: [/^electron/, /^react/, /^zod/, /^zustand/, /^@tanstack/],
})
