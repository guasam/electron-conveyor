# Window Targeting

Once your app has more than one window, "push this event" needs an answer to "push it *where*?" The
**window manager** is a small label → window registry that produces the target resolvers
[`createEmitter`](/guide/events) expects — so you can fan an event out to one window, all windows,
or everyone except the sender.

## Create and register

Create one manager for your app and register each window under a label as you open it:

```ts
import { createWindowManager } from 'electron-conveyor/main'

export const windows = createWindowManager()

app.whenReady().then(() => {
  windows.register('main', createAppWindow())
  windows.register('settings', createSettingsWindow())
})
```

`register` tracks the window and **auto-untracks it when it closes**, so the registry never holds a
dead window. It returns the window, so you can wrap a `createWindow()` call inline as above.

## Target resolvers

The manager exposes three resolvers, each usable directly as an `EmitTarget`:

| Resolver              | Sends to…                                        |
| --------------------- | ------------------------------------------------ |
| `windows.broadcast`   | every tracked, live window                       |
| `windows.to(label)`   | the single window registered under `label`       |
| `windows.except(sender)` | every tracked window except the one that owns `sender` |

They're resolved **at emit time**, so windows opening and closing between emits is handled
automatically — a broadcast never targets a window that has since closed.

```ts
import { createEmitter } from 'electron-conveyor/main'

// notify every window
const toAll = createEmitter(notifyModule, windows.broadcast)
toAll.onMessage('Update installed')

// notify one specific window
const toSettings = createEmitter(settingsModule, windows.to('settings'))
toSettings.onThemeChange('dark')
```

### "Everyone but me"

`except(sender)` is the classic broadcast-to-peers pattern — echo a change to the other windows but
not the one that caused it. `ctx.sender` from a procedure handler is exactly the argument it wants:

```ts
broadcastRename: procedure()
  .input(z.object({ id: z.string(), name: z.string() }))
  .handle(({ input, ctx }) => {
    const emit = createEmitter(docModule, windows.except(ctx.sender))
    emit.onRenamed(input)
  }),
```

## Reading the registry

The manager is also a plain registry you can query from main code:

```ts
windows.get('settings') // BrowserWindow | undefined
windows.all() // BrowserWindow[]  — tracked & live
windows.labels() // string[]        — every registered label
```

## Single-window apps

If you only ever have one window, you don't need the manager at all — pass the `BrowserWindow`
straight to `createEmitter`:

```ts
const emit = createEmitter(windowModule, win)
```

The manager earns its place the moment a second window appears.
