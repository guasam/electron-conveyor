# Mental Model

Conveyor has a small surface. Once you can map "what I want to do" onto the right primitive, the
rest is detail. This page is that map.

## Four things you can want

| You want…                                   | Reach for…              | Direction              |
| ------------------------------------------- | ----------------------- | ---------------------- |
| Renderer to call main and get a result      | `procedure().output(z)` | renderer → main → back |
| Renderer to tell main something (awaitable) | `procedure()` (void)    | renderer → main        |
| Main to push to the renderer                | `event(z)`              | main → renderer        |
| State shared live across all windows        | `defineStore(...)`      | main = source of truth |

Procedures and events are declared **inside a module**. Stores are declared on their own and
registered separately.

## The flow of a call

A procedure call travels a fixed path, and every step is typed or validated:

```
renderer                     preload            main
────────                     ───────            ────
conveyor.app.version()  ─►  invoke(channel) ─►  ipcMain.handle
                                                  │  validate input (Zod)
                                                  │  run handler
                                                  │  validate output (dev only)
        string  ◄─────────  result envelope ◄─────┘
```

- **Input** is validated on every call — it's the trust boundary between an untrusted renderer and
  privileged main code.
- **Output** is validated in development only, as a correctness aid (it comes from your own trusted
  main code, so it isn't a security concern in production).
- The result crosses the wire as a **typed envelope** (`{ ok: true, data }` or `{ ok: false, error }`).
  The client unwraps it: success returns `data`; failure throws a
  [`ConveyorError`](/guide/error-handling).

## Where inference comes from

There is no code generation. The chain is:

1. A `procedure()` builder captures the input type (from `.input(schema)`) and the result type
   (from what `.handle()` returns).
2. `defineModule` collects those into a record.
3. `createRouter` collects modules into a router; `type AppRouter = typeof router` snapshots the
   whole contract as a type.
4. `createConveyorClient<AppRouter>()` returns a `Proxy` whose **type** is derived from
   `AppRouter` — procedures become async methods, events become `{ subscribe }`.

The client carries no runtime metadata about your methods. It's a pure proxy over two preload
functions, which is why none of your main-process code leaks into the renderer bundle.

## What runs where

| Concern                        | Process  | Entry point                     |
| ------------------------------ | -------- | ------------------------------- |
| Authoring (modules, stores)    | any      | `electron-conveyor/define`      |
| Registering handlers, emitting | main     | `electron-conveyor/main`        |
| Calling, subscribing, hooks    | renderer | `electron-conveyor/renderer`    |
| The context-bridge             | preload  | `electron-conveyor/preload`     |

Authoring primitives are pure (no `electron`/`node`/`react` runtime), which is what lets a store
definition be shared by both main and renderer. The [Process Boundary](/guide/process-boundary)
guide covers the rules that keep this clean.

## Naming

Channels are derived, never written by hand:

- Procedures use `conveyor:${moduleId}`, dispatched by method name.
- Events use `conveyor:event:${moduleId}:${eventName}`.
- Stores use `conveyor:store:${storeId}` (and `…:changed` for broadcasts).

You never type these strings, so you can never mistype them.
