# Conveyor

Type-safe IPC + cross-window state for Electron, with **one source of truth per feature** and
**end-to-end inference** — no hand-written client, no magic channel strings, no query keys.

Define a feature in one file; the renderer client type is inferred from it. Adding an IPC call
is one edit, and a typo is a compile error, not a runtime surprise.

```ts
// main — the definition IS the API
export const system = defineModule({
  info: query(() => ({ platform: process.platform, mem: os.freemem() })),
  openUrl: command(z.url(), ({ input }) => shell.openExternal(input)),
})

// renderer — inferred, typed, auto-keyed
const info = conveyor.system.info.useQuery({ refetchInterval: 1500 })
await conveyor.system.openUrl('https://example.com')
```

## Install

```sh
npm install electron-conveyor
```

`electron` is the only required peer. `zod` (or any [Standard Schema](https://standardschema.dev)
validator — Valibot and ArkType work too), `react`, `@tanstack/react-query` and `zustand` are
optional peers — install the ones whose features you use.

## Mental model — five primitives

| You want…                            | Use           | Renderer side                        |
| ------------------------------------ | ------------- | ------------------------------------ |
| Read something from main             | `query()`     | `await it()`, or `.useQuery()`       |
| Tell main to do something            | `command()`   | `await it()`, or `.useMutation()`    |
| Chunks pushed as they're produced    | `stream()`    | `for await`, or `.useStream()`       |
| Main pushing to the renderer         | `event()`     | `.subscribe(cb)`, or `.useEvent(cb)` |
| State shared live across all windows | `defineStore` | `useConveyorStore(def)`              |

Queries and commands dispatch identically — the split exists so the client can auto-wire the
right hook and derive query keys from the call path (you never write a key by hand).

**The rule: no schema, no input.** A member that accepts renderer input must declare the input's
schema — renderer input is the trust boundary and is always validated in main.

## Import map (one entry point per process)

```ts
import { initConveyor, defineStore, ConveyorError } from 'electron-conveyor/define' // authoring (pure, any process)
import { createRouter, createEmitter, createWindowManager, devLogger } from 'electron-conveyor/main' // main only
import { createConveyorReactClient, useConveyorStore } from 'electron-conveyor/react' // renderer (React)
import { createConveyorClient } from 'electron-conveyor/renderer' // renderer (no React)
import { exposeConveyor } from 'electron-conveyor/preload' // preload only
```

## Wire it up once

```ts
// conveyor/init.ts — bind the authoring primitives to your app's context shape
import { initConveyor } from 'electron-conveyor/define'

export interface AppContext {
  user: User | null
}

export const { query, command, stream, event, middleware, defineModule } = initConveyor<AppContext>()
```

```ts
// preload — the whole preload; invoke + subscribe + manifest, nothing app-specific
import { exposeConveyor } from 'electron-conveyor/preload'
exposeConveyor()
```

```ts
// main — conveyor/router.ts: the app's whole IPC surface, registered in one place
export const router = createRouter(
  { system, window: windowModule }, // module ids come from these keys
  {
    createContext: () => ({ user: currentUser }), // required because initConveyor<AppContext>
    use: [devLogger], // optional global middleware (dev call timing)
    stores: [settingsStore], // optional cross-window stores
  }
)
export type AppRouter = typeof router // ← the only thing the renderer imports
```

```ts
// renderer — conveyor/client.ts
import { QueryClient } from '@tanstack/react-query'
import { createConveyorReactClient } from 'electron-conveyor/react'
import type { AppRouter } from './router'

export const queryClient = new QueryClient()
export const conveyor = createConveyorReactClient<AppRouter>({ queryClient })
```

The renderer imports only `type AppRouter` — schemas and handlers never leave main. At runtime the
client bootstraps from a tiny kind manifest (member names + kinds, fetched once), so calls return
real Promises / AsyncIterables and a typo'd member name throws immediately.

## Queries and commands

```ts
export const files = defineModule({
  // no input → no schema needed
  recent: query(({ ctx }) => listRecent(ctx.user)),

  // input crosses the trust boundary → schema required, validated on every call
  rename: command(z.object({ path: z.string(), to: z.string() }), ({ input }) => fs.rename(input.path, input.to)),

  // rare full form: `returns` is a dev-only result check (not security)
  stats: query({ returns: z.object({ count: z.number() }) }, () => readStats()),
})
```

Every handler receives `ctx`: the calling `window`/`sender`/`event`, plus your `AppContext`, plus
whatever middleware added. Renderer side:

```ts
const recent = conveyor.files.recent.useQuery() // key: ['conveyor','files','recent']
const rename = conveyor.files.rename.useMutation({ onSuccess: () => conveyor.files.recent.invalidate() })
await conveyor.files.recent() // plain call outside React
```

## Streams

```ts
export const chat = defineModule({
  respond: stream(z.string(), async function* ({ input, signal }) {
    for await (const token of llm.complete(input)) {
      if (signal.aborted) return // fires when the renderer stops or its window closes
      yield token
    }
  }),
})
```

```ts
for await (const token of conveyor.chat.respond(prompt)) append(token) // break → cancels in main

conveyor.chat.respond.useStream({ input: prompt, onData: append, onEnd: done }) // or the hook
```

## Middleware — reusable bases

Middleware attaches to _bases_, not per-call chains. Derive once, use everywhere:

```ts
const requireUser = middleware(({ ctx, next }) => {
  if (!ctx.user) throw new ConveyorError('UNAUTHORIZED', 'Sign in first')
  return next({ ctx: { user: ctx.user } }) // narrows ctx.user to non-null downstream
})

const authed = command.use(requireUser) // a derived base; query.use / stream.use likewise

export const account = defineModule({
  delete: authed(({ ctx }) => deleteAccount(ctx.user.id)), // ctx.user: User — narrowed
})
```

## Events (main → renderer push)

```ts
export const windowModule = defineModule({
  onFocusChange: event(z.boolean()),
})

// main: wire sources to the typed emitter (single window, or a manager fan-out)
const emit = createEmitter(windowModule, win)
win.on('focus', () => emit.onFocusChange(true))

// renderer
conveyor.window.onFocusChange.useEvent(setFocused)
```

`createWindowManager()` tracks windows by label and produces fan-out targets:
`createEmitter(mod, manager.broadcast)`, `.to('settings')`, `.except(ctx.sender)`.

## Cross-window stores

Main owns the state; every window mirrors it live. Action payloads are validated (same
schema-first rule), and the payload parameter's type comes from the schema:

```ts
export const settingsStore = defineStore('settings', {
  state: { theme: 'dark' as 'light' | 'dark', zoom: 1 },
  schemas: { setTheme: z.enum(['light', 'dark']) },
  actions: {
    setTheme: (s, theme) => {
      s.theme = theme
    }, // theme: 'light' | 'dark' — from the schema
    resetZoom: (s) => {
      s.zoom = 1
    }, // no payload → no schema
  },
  persist: true, // JSON under userData — survives restarts
})
```

Registered via `createRouter`'s `stores` option; the returned `router.stores.settings` handle lets
main read (`getState`), write (`dispatch`), and `subscribe`. Renderer:

```ts
const theme = useConveyorStore(settingsStore, (s) => s.theme) // re-renders only when the slice changes
const { setTheme } = useConveyorActions(settingsStore) // stable refs, never re-renders
```

## Errors

Failures cross the boundary as a typed envelope and re-throw in the renderer as `ConveyorError`
with a stable `code` (`INVALID_INPUT` carries the schema `issues`). Handlers can throw their own
codes — branch on `err.code`, never on message strings:

```ts
throw new ConveyorError('UNAUTHORIZED', 'Sign in first') // main

if (e instanceof ConveyorError && e.code === 'UNAUTHORIZED') showLogin() // renderer
```

## Testing

`createCaller` runs procedures in-process — validation, middleware and all — with no electron:

```ts
const caller = createCaller(router, { ctx: { user: testUser } })
expect(await caller.files.recent()).toEqual([])
await expect(caller.account.delete()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
```

## Process boundary — the rules

- Module files run in **main only** — the renderer must never import them (it imports `type AppRouter`).
- Store definitions are **pure and shared** — both processes import them.
- The preload is static: two functions + the manifest read. It never changes as your API grows,
  and it is sandbox-compatible (`sandbox: true` works; bundle conveyor into the preload — a
  sandboxed preload's `require` cannot resolve node_modules).
- Input schemas are security; `returns` schemas are a dev-only correctness aid.

## Migrating from 0.3 (the v2 API)

| v2                                             | v3                                             |
| ---------------------------------------------- | ---------------------------------------------- |
| `procedure().input(s).handle(fn)`              | `query(s, fn)` or `command(s, fn)`             |
| `procedure().handle(fn)`                       | `query(fn)` / `command(fn)`                    |
| `procedure().output(s)`                        | drop it, or `query({ returns: s }, fn)`        |
| `procedure().use(mw).handle(fn)`               | `const base = query.use(mw)` → `base(fn)`      |
| `procedure().input(s).stream(gen)`             | `stream(s, gen)`                               |
| `defineModule('id', {...})`                    | `defineModule({...})` — id = router key        |
| `registerStore(def)` + separate call           | `createRouter(mods, { stores: [def] })`        |
| `createConveyorClient` + `createConveyorHooks` | `createConveyorReactClient` (hooks on members) |
| `useConveyorQuery(['key'], (c) => c.m.f())`    | `conveyor.m.f.useQuery()`                      |
| `useConveyorEvent((c) => c.m.e, cb)`           | `conveyor.m.e.useEvent(cb)`                    |
| `useConveyorStore` from `/renderer`            | from `/react`                                  |

## License

MIT
