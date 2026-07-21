# What is Conveyor?

Conveyor is a small library for **type-safe IPC and cross-window state in Electron**. It gives
you *one source of truth per feature* and *end-to-end type inference* — no hand-written client, no
magic channel strings.

You define a feature in a single file. The renderer's client type is **inferred** from that
definition, so adding an IPC call is one edit and a typo becomes a compile error instead of a
runtime surprise.

## The problem it solves

Wiring IPC in Electron by hand means keeping several files in lockstep for every single call:

- a channel string constant (`'app:get-version'`) shared between processes,
- an `ipcMain.handle` in the main process,
- an `ipcRenderer.invoke` — usually wrapped and re-exposed through the preload's context bridge,
- a hand-maintained TypeScript type describing what the renderer can call.

Nothing connects these. Rename a channel and you find out at runtime. Change a payload shape and
the renderer's types happily lie to you. Multiply that friction across every feature.

## How Conveyor changes it

Everything about a feature lives in one **module**: the channel namespace, the input/output
schemas, and the handler. The renderer never imports any of that runtime — it imports **only the
router's type** and infers a fully-typed client from it.

```ts
// One definition in the main process…
export const appModule = defineModule('app', {
  version: procedure()
    .output(z.string())
    .handle(() => app.getVersion()),
})

// …and the renderer calls it, fully typed, with zero client code written:
const version = await conveyor.app.version() // string
```

Rename `version`, change its output type, or delete it — the renderer call stops compiling. That's
the whole idea.

## What you get

| Capability                                  | Primitive               | Direction              |
| ------------------------------------------- | ----------------------- | ---------------------- |
| Renderer calls main and gets a result       | `procedure().output(z)` | renderer → main → back |
| Renderer tells main something (awaitable)   | `procedure()` (void)    | renderer → main        |
| Main pushes to the renderer                  | `event(z)`              | main → renderer        |
| State shared live across all windows         | `defineStore(...)`      | main = source of truth |

Each of these has its own guide: [Procedures](/guide/procedures), [Events](/guide/events), and
[Stores](/guide/stores).

## Design principles

- **Inference over declaration.** You write the definition once; types flow outward. The client is
  a `Proxy`, not generated code.
- **The renderer stays clean.** It imports `type AppRouter` (erased at build) and nothing else from
  main. No `electron` or `node` runtime ever reaches the renderer bundle.
- **Validate at the trust boundary.** Inputs are always validated with [Zod](https://zod.dev);
  outputs are validated in development as a correctness aid.
- **Small, sandbox-friendly preload.** The context bridge exposes just two functions —
  `invoke` and `subscribe`. The typed client is built on top of them in the renderer.

## Requirements

Conveyor targets **Electron 30+** and uses **Zod 4** for validation. React,
`@tanstack/react-query`, and Zustand are optional peers — you only need them if you use the React
hooks or cross-window stores.

Ready to wire it up? Head to [Getting Started](/guide/getting-started).
