# Procedures

A **procedure** is a renderer → main call. The renderer invokes it, main runs the handler, and the
result comes back — fully typed, validated at the boundary. Procedures are the workhorse of
Conveyor.

## The builder

`procedure()` is a small fluent builder with three optional steps, always ending in `.handle()`:

```ts
procedure()
  .input(schema) // declare & validate the single argument (optional)
  .output(schema) // declare the result shape (optional, validated in dev)
  .handle(({ input, ctx }) => {
    /* implementation */
  })
```

The **input type flows** from `.input()` into your handler's `input` argument, and the **result
type is inferred** from whatever `.handle()` returns. Both become part of the renderer client type.

## Four shapes

### Result, no input

```ts
version: procedure()
  .output(z.string())
  .handle(() => app.getVersion()),
```

```ts
const v = await conveyor.app.version() // Promise<string>
```

### Input and result

```ts
read: procedure()
  .input(z.string())
  .output(z.string())
  .handle(({ input }) => readFile(input, 'utf-8')),
```

```ts
const text = await conveyor.file.read('/path/to/file') // Promise<string>
```

### Input, no result (a command)

```ts
openUrl: procedure()
  .input(z.string().url())
  .handle(({ input }) => shell.openExternal(input)),
```

```ts
await conveyor.web.openUrl('https://example.com') // Promise<void>, still awaitable
```

### Neither — a void command

```ts
minimize: procedure().handle(({ ctx }) => ctx.window?.minimize()),
```

```ts
await conveyor.window.minimize()
```

::: tip
The result type is whatever your handler returns — you don't need `.output()` for the return type
to be inferred. `.output()` adds **runtime validation** (in development) on top of the inferred
type. Use it when you want a guarantee the shape is what you think it is.
:::

## The handler context (`ctx`)

Every handler receives `ctx`, built fresh per invocation from the incoming IPC event. It always
reflects the **calling** window, so a single handler works correctly across many windows:

| Field        | Type                    | What it is                                             |
| ------------ | ----------------------- | ------------------------------------------------------ |
| `ctx.window` | `BrowserWindow \| null` | The window that made the call. `null` for a `<webview>` or offscreen sender. |
| `ctx.sender` | `WebContents`           | The calling frame's web contents.                      |
| `ctx.event`  | `IpcMainInvokeEvent`    | The raw Electron invoke event, if you need it.         |

Because `ctx` resolves the caller every time, you never hard-code "the main window." A window
control module works no matter how many windows you open:

```ts
export const windowModule = defineModule('window', {
  minimize: procedure().handle(({ ctx }) => ctx.window?.minimize()),
  close: procedure().handle(({ ctx }) => ctx.window?.close()),
  maximizeToggle: procedure().handle(({ ctx }) => {
    const win = ctx.window
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  }),
})
```

Operations on web content act on `ctx.sender`, so they target the calling frame directly:

```ts
copy: procedure().handle(({ ctx }) => ctx.sender.copy()),
paste: procedure().handle(({ ctx }) => ctx.sender.paste()),
```

## Validation

- **Input** is validated on **every** call with the `.input()` schema — this is the trust boundary.
  If it fails, the handler never runs and the renderer receives an `INVALID_INPUT`
  [`ConveyorError`](/guide/error-handling) carrying the Zod issues.
- **Output** is validated with the `.output()` schema in **development only**. A mismatch surfaces
  as `INVALID_OUTPUT`. In production, trusted main output is passed through unchecked for speed.

Schemas can carry refinements, and the validated (parsed) value is what your handler receives:

```ts
openUrl: procedure()
  .input(
    z.string().refine((s) => {
      try {
        const { protocol } = new URL(s)
        return protocol === 'https:' || protocol === 'http:'
      } catch {
        return false
      }
    }, 'Only http(s) URLs may be opened externally')
  )
  .handle(({ input }) => shell.openExternal(input)),
```

## Async handlers

Handlers may be sync or async — the client always returns a `Promise`, and the inferred type
unwraps your return value with `Awaited<>`:

```ts
stat: procedure()
  .input(z.string())
  .handle(async ({ input }) => (await fs.stat(input)).size), // Promise<number> on the client
```

## Adding a procedure is one edit

To add a call, add one entry to a module. No channel constant, no preload change, no client method:

```ts
export const appModule = defineModule('app', {
  version: procedure().output(z.string()).handle(() => app.getVersion()),
  quit: procedure().handle(() => app.quit()), // [!code ++]
})
```

```ts
await conveyor.app.quit() // immediately available and typed
```
