# The Process Boundary

Conveyor's type safety and its clean bundles both rest on one discipline: keeping main-process code
out of the renderer. This page states the rules that make that automatic, and why they hold.

## The three rules

### 1. The renderer imports only a type from the router

```ts
// conveyor/client.ts (renderer)
import type { AppRouter } from './router' // type-only → erased at build
```

The `import type` is erased entirely when the renderer is bundled. `AppRouter` is
`typeof router` — a *type*, carrying no runtime. So although the router file imports `electron` and
your handlers, **none of that reaches the renderer bundle**. The renderer only ever learns the
*shape* of your API, never its implementation.

If you drop the `type` keyword, you pull the router's runtime — and `electron` — into the renderer.
Always keep it type-only.

### 2. Author with `define`; never import `main` from the renderer

```ts
import { defineModule, procedure, event, defineStore } from 'electron-conveyor/define' // ✅ pure, anywhere
```

The `electron-conveyor/define` entry point is **pure** — no `electron`, `node`, or `react` runtime.
It's safe to import in any process. The `electron-conveyor/main` entry pulls in `electron` and must
only be imported from main-process code.

The client is a `Proxy` with no metadata about your methods, which is what makes rule 1 possible:
there's simply nothing implementation-specific to leak.

### 3. Store definitions must be pure

```ts
export const settingsStore = defineStore('settings', {
  state: { theme: 'dark' as 'light' | 'dark' },
  actions: {
    setTheme: (s, t: 'light' | 'dark') => {
      s.theme = t
    },
  },
})
```

A store is imported by **both** processes — main registers it as the source of truth, and each
renderer imports it to mirror the state and bind actions. That only works if the definition has no
side effects and no `electron`/`node` imports. Reducers mutate the draft and nothing else; side
effects live in [procedures](/guide/procedures).

## Why the preload is tiny

The context bridge exposes just two functions:

```ts
interface ConveyorBridge {
  invoke: (channel: string, method: string, ...args: unknown[]) => Promise<unknown>
  subscribe: (channel: string, cb: (payload: unknown) => void) => Unsubscribe
}
```

No Zod, no per-method wrappers, no generated surface. Everything typed is reconstructed renderer-side
by the client `Proxy` over these two calls. A minimal preload keeps startup fast and stays
compatible with `sandbox: true`.

## What lives where

| File / entry                 | Side     | Responsibility                                              |
| ---------------------------- | -------- | ----------------------------------------------------------- |
| `electron-conveyor/define`   | any      | authoring primitives — pure, no runtime deps                |
| `electron-conveyor/main`     | main     | `createRouter` / `createEmitter` / `registerStore` / window manager (electron glue) |
| `electron-conveyor/renderer` | renderer | typed client, React hooks, store hooks, `ConveyorError`     |
| `electron-conveyor/preload`  | preload  | the two-function context bridge                             |
| your `router.ts`             | main     | combines modules; exports **`type AppRouter`** for the renderer |

Follow the three rules and the boundary enforces itself — the compiler stops a stray `main` import,
and the build erases the router type. You get end-to-end types with a renderer bundle that contains
none of your privileged code.
