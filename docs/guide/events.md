# Events

An **event** is a main → renderer push. Where a [procedure](/guide/procedures) is pulled by the
renderer, an event is emitted by main whenever it wants — a download progressed, a window gained
focus, a background job finished. Payloads are typed, and the renderer subscribes.

## Declare it

Events are declared inside a module, right alongside procedures, with `event(schema)`. The schema
types the payload:

```ts
import { defineModule, procedure, event } from 'electron-conveyor/define'
import { z } from 'zod'

export const windowModule = defineModule('window', {
  // procedures…
  minimize: procedure().handle(({ ctx }) => ctx.window?.minimize()),

  // main → renderer pushes
  onFocusChange: event(z.boolean()),
  onMaximizeChange: event(z.boolean()),
})
```

An event has no handler — it's just a typed channel. The handler lives on the main side, where you
decide *when* to emit.

## Emit it from main

`createEmitter(module, target)` builds the typed push functions for a module against a target. Wire
your main-side sources — native window events, an EventEmitter, a timer — to those functions:

```ts
import { createEmitter } from 'electron-conveyor/main'

export function setupWindowEvents(win: BrowserWindow): void {
  const emit = createEmitter(windowModule, win)

  win.on('focus', () => emit.onFocusChange(true))
  win.on('blur', () => emit.onFocusChange(false))
  win.on('maximize', () => emit.onMaximizeChange(true))
  win.on('unmaximize', () => emit.onMaximizeChange(false))
}
```

`emit` only exposes the module's **events** (`onFocusChange`, `onMaximizeChange`), each typed to its
payload — `emit.onFocusChange('yes')` is a compile error. In development the payload is also
validated against the schema before it's sent.

Call `setupWindowEvents(win)` once per window you create.

## The target

The second argument to `createEmitter` is where the event goes. It's either a single window or a
resolver that returns the current set of windows:

```ts
// a single window
createEmitter(windowModule, win)

// fan-out via a window manager (see Window Targeting)
createEmitter(fileModule, windows.broadcast) // every tracked window
createEmitter(fileModule, windows.to('settings')) // one labelled window
createEmitter(fileModule, windows.except(ctx.sender)) // everyone but the caller
```

Resolvers are evaluated at emit time, so windows opening and closing between emits is handled for
you. See [Window Targeting](/guide/window-targeting) for the full fan-out story.

## Subscribe in the renderer

### Plain client

Every event member on the client has a `.subscribe(listener)` method. It returns an unsubscribe
function:

```ts
import { conveyor } from './conveyor/client'

const unsubscribe = conveyor.window.onFocusChange.subscribe((focused) => {
  document.body.classList.toggle('app-focused', focused)
})

// later
unsubscribe()
```

### React

The `useConveyorEvent` hook subscribes for the lifetime of the component and cleans up on unmount:

```tsx
import { useConveyorEvent } from './conveyor/client'

function TitleBar() {
  const [focused, setFocused] = useState(true)

  useConveyorEvent(
    (c) => c.window.onFocusChange,
    (focused) => setFocused(focused)
  )

  return <div className={focused ? 'focused' : 'blurred'}>…</div>
}
```

The listener always sees the latest closure, so you can reference current props and state inside it
without re-subscribing. See [React Hooks](/guide/react-hooks) for the details.

## A worked example: download progress

```ts
// module
export const downloadModule = defineModule('download', {
  start: procedure().input(z.string()).handle(({ input, ctx }) => {
    beginDownload(input, ctx.window)
  }),
  onProgress: event(z.number()),
  onDone: event(z.object({ path: z.string() })),
})
```

```ts
// main — wire the source to the emitter for the requesting window
function beginDownload(url: string, win: BrowserWindow | null) {
  if (!win) return
  const emit = createEmitter(downloadModule, win)
  downloader.on('progress', (p) => emit.onProgress(p))
  downloader.on('done', (path) => emit.onDone({ path }))
}
```

```tsx
// renderer
useConveyorEvent((c) => c.download.onProgress, setProgress)
useConveyorEvent((c) => c.download.onDone, ({ path }) => toast(`Saved to ${path}`))
```
