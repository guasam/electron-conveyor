# Conveyor

Type-safe IPC + cross-window state for Electron, with **one source of truth per feature** and
**end-to-end inference** — no hand-written client, no magic channel strings.

Define a feature in one file; the renderer client type is inferred from it. Adding an IPC call
is one edit, and a typo is a compile error, not a runtime surprise.

## Install

```sh
npm install electron-conveyor
```

`electron` is the only required peer. `zod` (or any [Standard Schema](https://standardschema.dev)
validator), `react`, `@tanstack/react-query` and `zustand` are optional peers — install the ones
whose features you use. Schemas are Standard Schema, so Valibot or ArkType work as well as Zod.

## Mental model

| You want…                                   | Use a…                  | Direction              |
| ------------------------------------------- | ----------------------- | ---------------------- |
| Renderer to call main and get a result      | `procedure().output(s)` | renderer → main → back |
| Renderer to tell main something (awaitable) | `procedure()` (void)    | renderer → main        |
| Main to push chunks as they're produced     | `.stream(...)`          | main → renderer, many  |
| Main to push to the renderer                | `event(s)`              | main → renderer        |
| State shared live across all windows        | `defineStore(...)`      | main = source of truth |

## Import map (one entry point per process)

```ts
import { initConveyor, defineStore } from 'electron-conveyor/define' // authoring (pure, any process)
import { createRouter, createEmitter, registerStore } from 'electron-conveyor/main' // main only
import { createConveyorClient, createConveyorHooks, useConveyorStore } from 'electron-conveyor/renderer' // renderer only
import { exposeConveyor } from 'electron-conveyor/preload' // preload only
```

## Wire it up once

```ts
// conveyor/init.ts — bind the authoring primitives to your app's context shape
import { initConveyor } from 'electron-conveyor/define'

export interface AppContext {
  user: User | null
}

export const { procedure, defineModule, event, middleware } = initConveyor<AppContext>()
```

```ts
// preload
import { exposeConveyor } from 'electron-conveyor/preload'
exposeConveyor() // the whole preload — invoke + subscribe, nothing app-specific
```

```ts
// renderer
export const conveyor = createConveyorClient<AppRouter>()
export const { useConveyorQuery, useConveyorMutation, useConveyorEvent, useConveyorStream } =
  createConveyorHooks(conveyor)
```

## Add a procedure

```ts
// conveyor/file.ts
import { z } from 'zod'
import { defineModule, procedure } from './init'
import { readFile } from 'node:fs/promises'

export const fileModule = defineModule('file', {
  read: procedure()
    .input(z.string())
    .output(z.string())
    .handle(({ input }) => readFile(input, 'utf-8')),
})
```

Register it once:

```ts
// conveyor/router.ts
export const router = createRouter(
  { app: appModule, window: windowModule, file: fileModule },
  { createContext: () => ({ user: currentUser() }) }
)

export type AppRouter = typeof router // the ONLY thing the renderer imports from here
```

`createContext` is required exactly when your modules use a non-empty `AppContext` — authoring with
`initConveyor<AppContext>()` and forgetting it is a compile error, not an `undefined` at runtime.

Use it — fully typed, no client code written:

```ts
const text = await conveyor.file.read('/path') // string
const { data } = useConveyorQuery(['file', p], (c) => c.file.read(p))
```

`ctx` in every handler is `BaseContext & AppContext`: `ctx.window` (the _calling_ window, may be
null), `ctx.sender`, `ctx.event`, plus whatever `createContext` returned. Input is always validated;
output is validated in dev only.

## Stream results as they're produced

`.stream()` takes an async generator. Each `yield` is pushed to the renderer as it happens — the
pattern an LLM-style UI needs — and `signal` aborts when the renderer stops iterating or its window
closes.

```ts
// main
respond: procedure()
  .input(z.string())
  .output(z.string())         // validates each chunk (dev)
  .stream(async function* ({ input, signal }) {
    for (const token of tokenize(input)) {
      if (signal.aborted) return
      yield token
    }
  }),
```

```ts
// renderer — the call handle is async-iterable
for await (const token of conveyor.stream.respond(prompt)) {
  setOutput((o) => o + token)
}

// or as a hook
useConveyorStream((c) => c.stream.respond(prompt), { onData: append, onEnd: done }, [prompt])
```

Break out of the loop (or call `iterator.return()`) and the handler's `signal` fires.

## Guard and widen with middleware

`.use()` steps run before the handler. A step may reject, wrap the call around `await next()`, or
pass `next({ ctx })` to **widen the context type** for everything downstream.

```ts
const authed = middleware(async ({ ctx, next }) => {
  if (!ctx.user) throw new Error('Unauthorized')
  return next({ ctx: { user: ctx.user } }) // ctx.user is non-null from here on
})

remove: procedure()
  .use(authed)
  .input(z.string())
  .handle(({ input, ctx }) => db.delete(input, ctx.user.id)), // ctx.user: User, not User | null
```

## Add an event (main → renderer push)

```ts
// in a module
onProgress: event(z.number()),

// main — wire a source to the emitter, per window
const emit = createEmitter(fileModule, win)
downloader.on('progress', (p) => emit.onProgress(p))
```

```ts
// renderer
useConveyorEvent(
  (c) => c.file.onProgress,
  (p) => setProgress(p)
)
```

For multi-window apps, `createWindowManager()` tracks windows by label and hands `createEmitter` a
resolver instead of a single window:

```ts
const windows = createWindowManager()
windows.register('main', mainWin)

createEmitter(fileModule, windows.broadcast) // every tracked window
createEmitter(fileModule, windows.to('main')) // one by label
createEmitter(fileModule, windows.except(ctx.sender)) // everyone but the caller
```

## Add a cross-window store

```ts
// conveyor/stores/settings.ts  — pure reducers, safe to import anywhere
import { defineStore } from 'electron-conveyor/define'

export const settingsStore = defineStore('settings', {
  state: { theme: 'dark' as 'light' | 'dark' },
  actions: {
    setTheme: (s, t: 'light' | 'dark') => {
      s.theme = t
    },
  },
})

// main — register once
registerStore(settingsStore)
```

```ts
// renderer — feels local, synced across every window
const theme = useConveyorStore(settingsStore, (s) => s.theme) // re-renders only on theme
const { setTheme } = useConveyorActions(settingsStore) // stable
setTheme('light') // main mutates → broadcasts → all windows
```

## Errors

Failed procedures throw a `ConveyorError` in the renderer with a `code`
(`INVALID_INPUT` | `INVALID_OUTPUT` | `HANDLER_ERROR` | `UNKNOWN_PROCEDURE`) and, for validation
failures, the schema `issues`:

```ts
try {
  await conveyor.file.read(badPath)
} catch (e) {
  if (e instanceof ConveyorError && e.code === 'INVALID_INPUT') console.log(e.issues)
}
```

## Process boundary — the rules

- The renderer imports **only** `type AppRouter` from `conveyor/router.ts` (type-only → erased at
  build). No main runtime ever enters the renderer bundle.
- Store definitions must be **pure** (reducers only, no `electron`/`node` imports) so both processes
  can share them. Side effects belong in procedures, not store actions.
- Author with `electron-conveyor/define`; never import `electron-conveyor/main` from renderer code.

## License

MIT
