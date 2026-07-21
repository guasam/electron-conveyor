# API Reference

Every export, grouped by entry point. Import each symbol from the entry point for its process.

[[toc]]

## `electron-conveyor/define`

Pure authoring primitives — no `electron`/`react`/`zustand` runtime. Safe to import in any process.

### `defineModule(id, record)`

Group procedures and events under a namespace `id`. Returns a `Module`.

```ts
function defineModule<TId extends string, TRecord extends ModuleRecord>(
  id: TId,
  record: TRecord
): Module<TId, TRecord>
```

- **`id`** — the module namespace. Derives the IPC channel (`conveyor:${id}`).
- **`record`** — a map of names to `procedure()` or `event()` definitions.

### `procedure()`

Create a renderer → main procedure via a fluent builder. Always terminated with `.handle()`.

```ts
procedure()
  .input(schema)   // optional — declare & validate the argument
  .output(schema)  // optional — declare the result shape (validated in dev)
  .handle(resolver)
```

| Method             | Description                                                                                   |
| ------------------ | --------------------------------------------------------------------------------------------- |
| `.input(schema)`   | Zod schema for the single argument. Validated on **every** call. The parsed value is passed to the handler. Sets the client's argument type. |
| `.output(schema)`  | Zod schema for the result. Validated in **development only**. Does not change the inferred return type — that comes from the handler. |
| `.handle(resolver)`| The implementation. Receives `{ input, ctx }`. Its return value (awaited) becomes the client's result type. |

The resolver's `opts`:

- **`input`** — the validated input (type from `.input()`, or `void`).
- **`ctx`** — a [`HandlerContext`](#handlercontext).

### `event(schema)`

Declare a typed main → renderer push channel. No handler — emit it from main with
[`createEmitter`](#createemitter-module-target).

```ts
function event<TSchema extends z.ZodType>(payload: TSchema): EventDef<z.infer<TSchema>>
```

### `defineStore(id, config)`

Define cross-window state with pure reducers. Registered in main with
[`registerStore`](#registerstore-def); consumed in the renderer with
[`useConveyorStore`](#useconveyorstore-def-selector).

```ts
function defineStore<TId extends string, S, A extends StoreActions<S>>(
  id: TId,
  config: { state: S; actions: A }
): StoreDef<TId, S, A>
```

- **`config.state`** — the initial state.
- **`config.actions`** — reducers of the form `(state, ...args) => void` that mutate the draft. The
  `state` parameter is dropped from the client-facing signature; the remaining args become the
  action's parameters. **Keep actions pure.**

### Types

`HandlerContext`, `ProcedureDef`, `EventDef`, `Module`, `Router`, `ConveyorClient`, `EventEmitters`,
`Unsubscribe`, `StoreDef`, `StoreActions`, `StoreActionsClient`, `ConveyorStore`.

#### `HandlerContext`

Passed to every procedure handler, built fresh per invocation from the calling window.

```ts
interface HandlerContext {
  event: IpcMainInvokeEvent
  sender: WebContents
  window: BrowserWindow | null // null for a <webview>/offscreen sender
}
```

---

## `electron-conveyor/main`

Main-process only — pulls in `electron`.

### `createRouter(modules)`

Register every module's procedures on the main process (one `ipcMain.handle` per module) and return
the router value. Export its **type** for the renderer.

```ts
function createRouter<TModules extends ModuleMap>(modules: TModules): Router<TModules>
```

```ts
export const router = createRouter({ app: appModule, window: windowModule })
export type AppRouter = typeof router // the only thing the renderer imports
```

### `createEmitter(module, target)`

Build the typed push emitters for a module against a target. The returned object exposes one
function per **event** in the module, each typed to its payload (and validated against the schema in
development).

```ts
function createEmitter<TModule extends AnyModule>(
  mod: TModule,
  target: EmitTarget
): EventEmitters<TModule>
```

- **`target`** — a `BrowserWindow`, or a resolver `() => BrowserWindow[]` (use the window manager's
  `broadcast` / `to(label)` / `except(sender)`). Resolved at emit time.

### `registerStore(def)`

Register a store as the source of truth in main: holds state, runs actions, broadcasts changes to
all windows. Returns a main-side handle. Call once at startup.

```ts
function registerStore<TId extends string, S, A extends StoreActions<S>>(
  def: StoreDef<TId, S, A>
): StoreHandle<S, A>
```

#### `StoreHandle<S, A>`

```ts
interface StoreHandle<S, A> {
  getState: () => S
  dispatch: <K extends keyof A>(action: K, ...args: DropFirst<Parameters<A[K]>>) => void
}
```

- **`getState()`** — read the current source-of-truth state.
- **`dispatch(action, ...args)`** — run an action from main. Broadcasts the change like a
  renderer-triggered action does.

### `createWindowManager()`

Create a label → window registry that produces `EmitTarget` resolvers for fan-out. See
[Window Targeting](/guide/window-targeting).

```ts
function createWindowManager(): ConveyorWindowManager
```

#### `ConveyorWindowManager`

| Member               | Signature                             | Description                                             |
| -------------------- | ------------------------------------- | ------------------------------------------------------- |
| `register`           | `(label, win) => BrowserWindow`       | Track `win` under `label`; auto-untracked on close. Returns `win`. |
| `get`                | `(label) => BrowserWindow \| undefined` | The window for `label`, if tracked.                   |
| `all`                | `() => BrowserWindow[]`               | Every tracked, live window.                             |
| `labels`             | `() => string[]`                      | Every registered label.                                 |
| `to`                 | `(label) => () => BrowserWindow[]`    | Resolver for the window at `label`.                     |
| `broadcast`          | `() => BrowserWindow[]`               | Resolver for all tracked, live windows.                 |
| `except`             | `(sender) => () => BrowserWindow[]`   | Resolver for all tracked windows except `sender`'s.     |

### `resolveTargets(target)`

Normalize an `EmitTarget` to its current live, non-destroyed windows. Pure — useful in tests.

```ts
function resolveTargets(target: EmitTarget): BrowserWindow[]
```

### Types

`StoreHandle`, `EmitTarget`, `ConveyorWindowManager`.

```ts
type EmitTarget = BrowserWindow | (() => BrowserWindow[])
```

---

## `electron-conveyor/renderer`

Renderer-process only.

### `createConveyorClient<TRouter>()`

Build the typed client — a `Proxy` over `window.conveyor` carrying no runtime method metadata.
Procedures become async methods; events become `{ subscribe }`.

```ts
function createConveyorClient<TRouter extends Router>(): ConveyorClient<TRouter>
```

```ts
export const conveyor = createConveyorClient<AppRouter>()
await conveyor.app.version() // typed
conveyor.window.onFocusChange.subscribe((focused) => {}) // typed event
```

### `createConveyorHooks(client)`

Bind the React hooks to a client. Returns `{ useConveyorQuery, useConveyorMutation, useConveyorEvent }`.
See [React Hooks](/guide/react-hooks).

```ts
function createConveyorHooks<TRouter extends Router>(
  client: ConveyorClient<TRouter>
): ConveyorHooks<TRouter>
```

| Hook                  | Signature (abridged)                                                           |
| --------------------- | ------------------------------------------------------------------------------ |
| `useConveyorQuery`    | `(key, (c) => Promise<T>, options?) => UseQueryResult<T, Error>`               |
| `useConveyorMutation` | `((c, vars) => Promise<TData>, options?) => UseMutationResult<TData, Error, TVars>` |
| `useConveyorEvent`    | `((c) => { subscribe }, (payload) => void) => void`                            |

`options` accept TanStack Query options minus the managed `queryKey`/`queryFn`/`mutationFn`. Query
keys are namespaced under `'conveyor'`; queries retry once by default.

### `useConveyorStore(def, selector?)`

Subscribe a component to a cross-window store.

```ts
function useConveyorStore<S, A>(def: StoreDef): ConveyorStore<S, A> // whole store + actions
function useConveyorStore<S, A, T>(def: StoreDef, selector: (state: S) => T): T // a slice
```

- **With a selector** — returns that slice; re-renders only when the slice changes. Preferred.
- **Without** — returns full state merged with bound actions; re-renders on any change.

### `useConveyorActions(def)`

Return a store's bound actions with **stable** references (reading them never triggers a re-render).

```ts
function useConveyorActions<S, A>(def: StoreDef): StoreActionsClient<S, A>
```

### `ConveyorError`

Thrown by a failed procedure call. See [Error Handling](/guide/error-handling).

```ts
class ConveyorError extends Error {
  readonly code: ConveyorErrorCode
  readonly issues?: unknown // Zod issues for INVALID_INPUT / INVALID_OUTPUT
}

type ConveyorErrorCode = 'UNKNOWN_PROCEDURE' | 'INVALID_INPUT' | 'INVALID_OUTPUT' | 'HANDLER_ERROR'
```

### Types

`ConveyorBridge`, `ConveyorHooks`, `ConveyorQueryHook`, `ConveyorMutationHook`, `ConveyorEventHook`,
`ConveyorErrorCode`, `ConveyorErrorPayload`.

---

## `electron-conveyor/preload`

Preload only.

### `exposeConveyor()`

Expose the minimal bridge (`invoke` + `subscribe`) to the renderer over the context bridge — no Zod,
`sandbox`-compatible. Uses `contextBridge` when context isolation is on, otherwise assigns
`window.conveyor`.

```ts
function exposeConveyor(): void
```
