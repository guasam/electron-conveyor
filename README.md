# Electron Conveyor

Type-safe IPC and cross-window state for Electron.

You describe a feature once, in main, and the renderer gets a fully typed client for it. No channel
strings, no hand-written preload API, no query keys, no second copy of the types that drifts. Rename
a handler and the renderer stops compiling.

```ts
// main: the definition is the API
export const notes = defineModule({
  list: query(() => vault.readAll()),
  save: command(z.object({ title: z.string(), body: z.string() }), ({ input }) => vault.write(input)),
})
```

```ts
// renderer: inferred from that definition, hooks and query keys included
const notes = conveyor.notes.list.useQuery()
await conveyor.notes.save({ title: 'Ideas', body: 'Ship the thing' })
```

Every example below builds on that same notes app, one primitive at a time.

<br />

## Contents

- [Install](#install)
- [How it fits together](#how-it-fits-together)
- [Quick start](#quick-start)
- [The five primitives](#the-five-primitives)
- [The one rule: no schema, no input](#the-one-rule-no-schema-no-input)
- [Handler context](#handler-context)
- [Queries and commands](#queries-and-commands)
- [Streams](#streams)
- [Events](#events)
- [Cross-window stores](#cross-window-stores)
- [Middleware](#middleware)
- [Errors](#errors)
- [Testing](#testing)
- [Multiple windows](#multiple-windows)
- [Rules of the road](#rules-of-the-road)
- [Troubleshooting](#troubleshooting)
- [Import map](#import-map)

<br />

## Install

```sh
npm install electron-conveyor
```

`electron` is the only peer you must have. The rest are optional, so install the ones whose features
you actually use:

| Package                 | You need it for                                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `zod`                   | validating renderer input (any [Standard Schema](https://standardschema.dev) validator works, so Valibot and ArkType are fine too) |
| `react`                 | the hooks on the client                                                                                                            |
| `@tanstack/react-query` | `useQuery`, `useMutation`, and typed `invalidate()`                                                                                |
| `zustand`               | cross-window stores                                                                                                                |

<br />

## How it fits together

Three pieces, one per process:

```
  renderer                      preload                main
  ──────────────────────        ─────────────────      ─────────────────────────
  conveyor.notes.list()   ───▶  window.conveyor  ───▶  the router dispatches to
  hooks, streams, stores        invoke/subscribe       your query/command/stream
                          ◀───  results, chunks  ◀───
                                events, store sync

  type AppRouter  ◀···········································  createRouter(...)
                          types only, no runtime crosses
```

1. **Main** runs `createRouter(...)`, which registers every handler with `ipcMain` the moment the
   file is imported.
2. **Preload** runs `exposeConveyor()`. That puts a two-function bridge (`invoke` and `subscribe`)
   on `window.conveyor`. It is the whole preload, and it never grows as your API does.
3. **Renderer** builds the client. At startup it reads a small manifest once (member names and their
   kinds) so a call can return a real Promise or a real AsyncIterable, and a typo'd member name
   throws right away instead of hanging.

The only thing crossing from main to the renderer at compile time is `type AppRouter`. Your schemas,
handlers and node imports stay in main.

<br />

## Quick start

Six files. Follow them in order.

```
1  conveyor/modules/notes.ts    a feature, defined once
2  conveyor/router.ts           every module, registered in one place
3  preload.ts                   the bridge
4  main.ts                      imports the router before any window opens
5  conveyor/client.ts           the renderer's typed client
6  renderer.tsx                 the QueryClient provider
```

### 1. Define a feature

This file runs in main only.

```ts
// conveyor/modules/notes.ts
import { z } from 'zod'
import { defineModule, query, command } from 'electron-conveyor/define'
import * as vault from '@/lib/vault'

export const notes = defineModule({
  list: query(() => vault.readAll()),
  save: command(z.object({ id: z.string(), title: z.string(), body: z.string() }), ({ input }) => vault.write(input)),
})
```

`vault` is your own plain-node code (reading and writing files, say). Nothing in it is
conveyor-specific, and conveyor never sees inside it. `@/` is just the app's own path alias, so use
whatever your project already does.

`list` takes no input, so it needs no schema. `save` takes input from the renderer, so it has to
declare one. That is [the one rule](#the-one-rule-no-schema-no-input).

### 2. Register the router

```ts
// conveyor/router.ts
import { createRouter, devLogger } from 'electron-conveyor/main'
import { notes } from './modules/notes'

export const router = createRouter(
  { notes }, // these keys become the module ids: conveyor.notes.*
  { use: [devLogger] } // optional: per-call timing in dev, a no-op in packaged builds
)

export type AppRouter = typeof router // the only thing the renderer imports
```

### 3. Expose the bridge in preload

```ts
// preload.ts
import { exposeConveyor } from 'electron-conveyor/preload'

exposeConveyor()
```

That really is the entire preload.

### 4. Import the router in main

`createRouter` registers handlers as it runs, so importing this file is what turns your API on. Do it
before any window opens.

```ts
// main.ts
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import './conveyor/router' // without this, calls find nothing

app.whenReady().then(() => {
  new BrowserWindow({
    webPreferences: { preload: join(__dirname, '../preload/preload.js'), sandbox: true },
  })
})
```

### 5. Build the client

The client is built from the router _type_ alone, so nothing from main ends up in the renderer
bundle.

```ts
// conveyor/client.ts
import { QueryClient } from '@tanstack/react-query'
import { createConveyorReactClient } from 'electron-conveyor/react'
import type { AppRouter } from './router'

export const queryClient = new QueryClient()
export const conveyor = createConveyorReactClient<AppRouter>({ queryClient })
```

### 6. Provide the QueryClient

The hooks are TanStack Query underneath, so they need its provider above them. Use the same instance
you passed to `createConveyorReactClient`, which is also what makes `conveyor.notes.list.invalidate()`
work outside of React.

```tsx
// renderer.tsx
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './conveyor/client'

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
)
```

### That's it, now use it

```tsx
import { conveyor } from './conveyor/client'

function Notes() {
  const notes = conveyor.notes.list.useQuery()
  const save = conveyor.notes.save.useMutation({
    onSuccess: () => conveyor.notes.list.invalidate(), // typed, and the key came from the call path
  })

  if (notes.isPending) return <p>Loading…</p>

  return (
    <>
      <ul>
        {notes.data.map((n) => (
          <li key={n.id}>{n.title}</li>
        ))}
      </ul>
      <button onClick={() => save.mutate({ id: crypto.randomUUID(), title: 'Untitled', body: '' })}>New note</button>
    </>
  )
}
```

> **Not using React?** Import `createConveyorClient` from `electron-conveyor/renderer` instead. You
> get the same members and the same types, just without the hooks.

<br />

## The five primitives

| You want to…                         | Define it with | Plain call                                      | React hook               |
| ------------------------------------ | -------------- | ----------------------------------------------- | ------------------------ |
| Read something from main             | `query()`      | `await conveyor.notes.list()`                   | `.useQuery()`            |
| Tell main to do something            | `command()`    | `await conveyor.notes.save(input)`              | `.useMutation()`         |
| Receive chunks as main produces them | `stream()`     | `for await (const h of conveyor.notes.find(q))` | `.useStream({ onData })` |
| Let main push to the renderer        | `event()`      | `conveyor.notes.onChanged.subscribe(cb)`        | `.useEvent(cb)`          |
| Share live state across every window | `defineStore`  | React only                                      | `useConveyorStore(def)`  |

Every member is callable on its own, so the plain-call column works anywhere, including outside React
and in a renderer built with `createConveyorClient`. The hooks are the same members with TanStack
Query wiring attached. Stores are the one exception: they are React-only in the renderer, though main
can always reach them through `router.stores.<id>`.

Queries and commands travel over the exact same wire. The split exists so the client knows which hook
to attach and how to derive a query key from the call path, which is why you never write a key by
hand.

<br />

## The one rule: no schema, no input

A member that accepts input from the renderer must declare that input's schema. Renderer input is the
trust boundary, so it is always validated in main before your handler sees it.

```ts
export const notes = defineModule({
  // no input, so no schema
  list: query(() => vault.readAll()),

  // input crosses the trust boundary, so a schema is required
  save: command(z.object({ id: z.string(), title: z.string(), body: z.string() }), ({ input }) => vault.write(input)),
})
```

The same rule applies to store action payloads. There is also a rarely needed full form with a
`returns` schema:

```ts
count: query({ returns: z.number() }, () => vault.readAll().length),
```

`returns` is a dev-only sanity check on your own output. It is a correctness aid, not a security
boundary, and it does not run in packaged builds.

<br />

## Handler context

Every handler receives `ctx`, which always carries the calling `event`, `sender` and `window`.

If your handlers need app-level things too, bind the primitives to a context type once. Our notes app
wants the open vault, which is `null` until the user unlocks it:

```ts
// conveyor/init.ts
import { initConveyor } from 'electron-conveyor/define'
import type { Vault } from '@/lib/vault'

export interface AppContext {
  vault: Vault | null
}

export const { query, command, stream, event, middleware, defineModule } = initConveyor<AppContext>()
```

Modules then import their primitives from this file rather than from the package:

```ts
// conveyor/modules/notes.ts
import { defineModule, query, command } from '../init' // not 'electron-conveyor/define'
```

`createRouter` now requires a matching `createContext`, so forgetting to supply the context is a
compile error rather than an `undefined` at runtime:

```ts
// conveyor/router.ts
import { getVault } from '@/lib/vault'

export const router = createRouter({ notes }, { createContext: () => ({ vault: getVault() }) })
```

`AppContext` is only a type, so referencing main-only services in it never pulls their runtime into
the renderer bundle. Skip this file entirely if you do not need it.

<br />

## Queries and commands

```ts
// conveyor/modules/notes.ts
export const notes = defineModule({
  list: query(() => vault.readAll()),
  get: query(z.string(), ({ input }) => vault.read(input)),
  save: command(z.object({ id: z.string(), title: z.string(), body: z.string() }), ({ input }) => vault.write(input)),
})
```

In the renderer, each member is callable _and_ carries its hooks:

```ts
const notes = conveyor.notes.list.useQuery() // key: ['conveyor','notes','list']
const save = conveyor.notes.save.useMutation({
  onSuccess: () => conveyor.notes.list.invalidate(),
})

await conveyor.notes.list() // a plain call, outside React
```

Hook options are passed as one object, with `input` alongside the TanStack options:

```ts
conveyor.notes.get.useQuery({ input: activeId, staleTime: 5_000 })
```

`invalidate()` takes the same input, so you can invalidate one note or the whole member:

```ts
conveyor.notes.get.invalidate(activeId) // just that one
conveyor.notes.get.invalidate() // every cached note
```

<br />

## Streams

Use a stream when main produces results over time, rather than one answer at the end. Searching the
vault can report hits as it walks:

```ts
// conveyor/modules/notes.ts
export const notes = defineModule({
  // ...list, get, save
  find: stream(z.string(), async function* ({ input, signal }) {
    for await (const hit of vault.walk(input)) {
      if (signal.aborted) return // the renderer stopped, or its window closed
      yield hit
    }
  }),
})
```

```ts
// plain: breaking out of the loop cancels the stream in main
for await (const hit of conveyor.notes.find(q)) addHit(hit)

// hook: subscribes for the component's lifetime, cancels on unmount
conveyor.notes.find.useStream({
  input: q,
  onData: addHit,
  onEnd: () => setSearching(false),
  deps: [q], // re-runs, cancelling the old search, whenever q changes
})
```

Include anything the stream depends on in `deps`, `input` included. Without it the hook keeps the
first stream running.

<br />

## Events

Events are main pushing to the renderer, with no request behind it. A note changing on disk is a good
one, since nothing in the renderer asked for it:

```ts
// conveyor/modules/notes.ts
export const notes = defineModule({
  // ...list, get, save, find
  onChanged: event(z.object({ id: z.string() })),
})
```

```ts
// conveyor/router.ts: wire the source to the typed emitter, after the router exists
import { createEmitter } from 'electron-conveyor/main'

export function watchVault(win: BrowserWindow) {
  const emit = createEmitter(notes, win)
  vault.onFileChange((id) => emit.onChanged({ id }))
}
```

```ts
// renderer: refresh the note that actually changed
conveyor.notes.onChanged.useEvent(({ id }) => conveyor.notes.get.invalidate(id))

// or outside React
const off = conveyor.notes.onChanged.subscribe(({ id }) => console.log('changed', id))
```

Create emitters _after_ the router, since module ids are assigned by `createRouter` from its keys.

<br />

## Cross-window stores

Main owns the state, every window mirrors it live, and a write from any window fans out to all of
them. Which note is selected is a good fit: open a second window and it follows along.

```ts
// conveyor/stores/ui.ts: pure, no electron and no react, so both processes import it
import { z } from 'zod'
import { defineStore } from 'electron-conveyor/define'

export const uiStore = defineStore('ui', {
  state: { activeNoteId: null as string | null, sidebarWidth: 240 },
  schemas: { setActive: z.string().nullable() },
  actions: {
    setActive: (s, id) => {
      s.activeNoteId = id // id is string | null, typed from the schema
    },
    resetSidebar: (s) => {
      s.sidebarWidth = 240 // no payload, so no schema needed
    },
  },
  persist: true, // JSON under userData, so it survives restarts
})
```

Register it on the router:

```ts
export const router = createRouter({ notes }, { stores: [uiStore] })
```

Read and write from the renderer:

```ts
const activeId = useConveyorStore(uiStore, (s) => s.activeNoteId) // re-renders only when this slice changes
const { setActive } = useConveyorActions(uiStore) // stable refs, so reading them never re-renders
```

Main can join in too, through `router.stores.ui`, which has `getState`, `dispatch` and `subscribe`.

Actions are pure reducers that mutate the draft. Keep side effects in commands, not here.

<br />

## Middleware

Middleware attaches to a _base_, not to a per-call chain. Derive the base once and reuse it. Our
`ctx.vault` is `Vault | null`, and most handlers should not have to keep checking:

```ts
// conveyor/init.ts
import { ConveyorError } from 'electron-conveyor/define'

export const requireVault = middleware(({ ctx, next }) => {
  if (!ctx.vault) throw new ConveyorError('LOCKED', 'Unlock the vault first')
  return next({ ctx: { vault: ctx.vault } }) // narrows ctx.vault to Vault downstream
})

export const unlocked = command.use(requireVault) // query.use and stream.use work the same way
```

```ts
// conveyor/modules/notes.ts
export const notes = defineModule({
  purge: unlocked(({ ctx }) => ctx.vault.clear()), // ctx.vault is Vault here, not Vault | null
})
```

For something that should run on every call, pass it to `createRouter`'s `use` option instead.

<br />

## Errors

Failures cross the boundary as a typed envelope and re-throw in the renderer as a `ConveyorError`
carrying a stable `code`. Branch on the code, never on the message:

```ts
// main, from the middleware above
throw new ConveyorError('LOCKED', 'Unlock the vault first')
```

```ts
// renderer
try {
  await conveyor.notes.purge()
} catch (e) {
  if (e instanceof ConveyorError && e.code === 'LOCKED') promptUnlock()
}
```

Four codes are reserved, and anything else, like `LOCKED`, is yours:

| Code                | Means                                                            |
| ------------------- | ---------------------------------------------------------------- |
| `UNKNOWN_PROCEDURE` | no such member, usually a router that was never imported         |
| `INVALID_INPUT`     | the input schema rejected the call, `err.issues` has the details |
| `INVALID_OUTPUT`    | a `returns` schema rejected your handler's result, dev only      |
| `HANDLER_ERROR`     | the handler threw something that was not a `ConveyorError`       |

<br />

## Testing

`createCaller` runs your procedures in-process, with validation and middleware intact and no electron
in sight. You supply the context directly, which is what makes the locked and unlocked paths easy to
cover:

```ts
import { createCaller } from 'electron-conveyor/define'
import { router } from '@/conveyor/router'

const open = createCaller(router, { ctx: { vault: testVault } })
const locked = createCaller(router, { ctx: { vault: null } })

expect(await open.notes.list()).toEqual([])
await expect(locked.notes.purge()).rejects.toMatchObject({ code: 'LOCKED' })
await expect(open.notes.save({ id: '1' })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
```

Electron's base context fields default to stubs, so pass only what your handlers actually read.
Router-global middleware (`createRouter`'s `use`) is skipped here.

<br />

## Multiple windows

`createWindowManager()` keeps a label to window registry and hands you fan-out targets:

```ts
const windows = createWindowManager()
windows.register('editor', editorWin)

createEmitter(notes, windows.broadcast) // every live window
createEmitter(notes, windows.to('editor')) // one window by label
createEmitter(notes, windows.except(ctx.sender)) // everyone but the window that asked
```

Windows are untracked automatically when they close. Cross-window stores need none of this, since
they already sync everywhere.

<br />

## Rules of the road

- **Module files run in main only.** The renderer must never import one. It imports `type AppRouter`
  and nothing else.
- **Store definitions are pure and shared.** Both processes import them, so keep electron and react
  out of those files.
- **The preload is static.** Two functions and one manifest read, and it never changes as your API
  grows.
- **Bundle conveyor into your preload** if you use `sandbox: true`, which you should. A sandboxed
  preload cannot resolve `node_modules` at runtime.
- **Input schemas are security. `returns` schemas are not.** One guards the trust boundary, the other
  catches your own mistakes in dev.

<br />

## Troubleshooting

| What you see                                               | What it means                                                                                        |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `No QueryClient set, use QueryClientProvider to set one`   | Step 6 is missing, or the provider holds a different instance than the one you gave the client       |
| `UNKNOWN_PROCEDURE` for a member you can see in the router | The router was never imported in main (step 4), so nothing registered                                |
| `window.conveyor is undefined`                             | The window has no `preload`, or the preload threw before reaching `exposeConveyor()`                 |
| `Cannot find module 'electron-conveyor'` in the preload    | A sandboxed preload cannot resolve `node_modules`, so bundle conveyor into the preload file          |
| `INVALID_INPUT` on a call you expected to pass             | The input schema rejected it, and `err.issues` carries the Standard Schema failures                  |
| `createEmitter: module has no id`                          | The emitter was created before `createRouter` ran, which is usually an import-order problem          |
| A store action throws at registration                      | An action that takes a payload has no entry in `schemas`, and renderer payloads are always validated |
| A `useStream` keeps showing the first result               | Its `deps` are missing the values the stream depends on, `input` included                            |

<br />

## Import map

One entry point per process, so an import that would break the process boundary is hard to write by
accident.

```ts
// authoring: pure, safe in any process
import { initConveyor, defineStore, ConveyorError, createCaller } from 'electron-conveyor/define'

// main only
import { createRouter, createEmitter, createWindowManager, devLogger } from 'electron-conveyor/main'

// renderer, with React
import { createConveyorReactClient, useConveyorStore, useConveyorActions } from 'electron-conveyor/react'

// renderer, without React
import { createConveyorClient } from 'electron-conveyor/renderer'

// preload only
import { exposeConveyor } from 'electron-conveyor/preload'
```
