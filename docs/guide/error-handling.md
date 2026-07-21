# Error Handling

When a [procedure](/guide/procedures) fails in main, the real error detail survives the IPC
boundary intact. Procedures return a typed envelope internally, and the client unwraps it: success
returns the data, failure throws a **`ConveyorError`** in the renderer.

## `ConveyorError`

```ts
import { ConveyorError } from 'electron-conveyor/renderer'

try {
  await conveyor.file.read(badPath)
} catch (e) {
  if (e instanceof ConveyorError) {
    console.log(e.code) // a stable ConveyorErrorCode
    console.log(e.message) // the real error message from main
    console.log(e.issues) // Zod issues, for validation failures
  }
}
```

`ConveyorError` extends `Error`, so `e.message` and `instanceof Error` behave as you'd expect. Two
extra fields carry the structured detail:

| Field       | Type                | When it's present                                   |
| ----------- | ------------------- | --------------------------------------------------- |
| `code`      | `ConveyorErrorCode` | always                                              |
| `issues`    | `unknown`           | validation failures (`INVALID_INPUT` / `INVALID_OUTPUT`) — the raw Zod issues array |

## Error codes

Branch on `code` rather than parsing the message:

| Code                | Meaning                                                                    |
| ------------------- | -------------------------------------------------------------------------- |
| `INVALID_INPUT`     | The argument failed the procedure's `.input()` schema. The handler never ran. Carries `issues`. |
| `INVALID_OUTPUT`    | The handler's return value failed the `.output()` schema. **Development only.** Carries `issues`. |
| `HANDLER_ERROR`     | The handler itself threw. `message` includes the thrown error's message.   |
| `UNKNOWN_PROCEDURE` | No procedure with that name exists on the module (e.g. a stale call).      |

```ts
try {
  await conveyor.file.read(userInput)
} catch (e) {
  if (e instanceof ConveyorError && e.code === 'INVALID_INPUT') {
    // e.issues is the Zod issues array — surface field-level detail
    showValidationErrors(e.issues)
  } else {
    showToast('Something went wrong')
  }
}
```

## Where validation happens

- **Input** is validated on **every** call — it's the trust boundary. A failure short-circuits
  before your handler runs and returns `INVALID_INPUT`.
- **Output** is validated in **development only**, as a correctness aid. In production, output from
  your trusted main code is passed through unchecked, so you'll never see `INVALID_OUTPUT` in a
  packaged build.
- A handler that throws for any other reason becomes `HANDLER_ERROR`, preserving the message.

In development, main also logs failures to the console with their code and issues, so you see them
without adding a `catch` everywhere.

## With the React hooks

The [hooks](/guide/react-hooks) are thin wrappers over TanStack Query, so a thrown `ConveyorError`
lands in the query/mutation `error` — already typed as `Error`, and narrowable to `ConveyorError`:

```tsx
const { data, error, isError } = useConveyorQuery(['file', path], (c) => c.file.read(path))

if (isError && error instanceof ConveyorError && error.code === 'INVALID_INPUT') {
  return <FieldErrors issues={error.issues} />
}
```

## Throwing meaningful errors from a handler

Throw normally in your handler — the message crosses the boundary as `HANDLER_ERROR`:

```ts
init: procedure()
  .output(windowInit)
  .handle(({ ctx }) => {
    const win = ctx.window
    if (!win) throw new Error('window.init called without an owning window')
    // …
  }),
```

The renderer sees `error.code === 'HANDLER_ERROR'` and
`error.message` containing `'window.init called without an owning window'`.
