# Changelog

## 0.4.0 — the v3 API

A ground-up redesign of the authoring and client surfaces (the wire machinery — envelope,
channels, dispatch — is largely unchanged). Breaking throughout; no runtime deprecations.
See the **Migrating from 0.3** table in the README for the mechanical mapping.

### Authoring

- **`query` / `command` / `stream` replace `procedure()`.** Callable factories instead of a
  builder: `query(({ ctx }) => ...)`, `command(schema, ({ input }) => ...)`. The kind split lets
  the client auto-wire `useQuery` vs `useMutation` and derive query keys.
- **Middleware moves to derived bases**: `const authed = command.use(requireAuth)` — reusable,
  composable, ctx-widening. Per-call `.use()` chains are gone.
- **`.output()` is demoted**: result checks are the rare full form (`query({ returns }, fn)`),
  dev-only as before. Input schemas remain mandatory for any member that takes input.
- **`defineModule` drops the id parameter** — module ids come from the `createRouter` keys, so a
  feature's name is declared exactly once.

### Router (main)

- `createRouter(modules, { createContext, use, stores })` — one registration point for the whole
  IPC surface: app context, router-global middleware (ships with a `devLogger`), and cross-window
  stores (returned as typed handles on `router.stores`).
- Serves a synchronous **kind manifest** the renderer client bootstraps from.
- All handler registration is HMR-safe (`removeHandler` before `handle`).

### Renderer client

- **Real Promises and AsyncIterables.** The dual thenable/iterable call handle (and its microtask
  claiming trick) is gone; the client knows each member's kind from the manifest. A typo'd member
  throws `UNKNOWN_PROCEDURE` synchronously at the call site.
- **New `electron-conveyor/react` entry — hooks live on the client proxy**:
  `conveyor.m.f.useQuery(opts)`, `.useMutation()`, `.useStream({...})`, `.useEvent(cb)`, plus
  typed `.invalidate()` / `.key()` with keys derived from the call path. `useConveyorStore` /
  `useConveyorActions` move here. `electron-conveyor/renderer` stays React-free.

### Stores

- **Schema-first action payloads**: `schemas.add: z.string()` types the action's payload parameter
  _and_ validates every renderer-invoked payload in main (previously unvalidated — a trust-boundary
  hole). An action that takes a payload without a schema is a registration error.
- **`persist: true`** — JSON persistence under `userData`, loaded at registration (shallow-merged),
  written debounced, flushed on quit.
- Main-side handles gain `subscribe(listener)`.

### Errors

- `ConveyorError(code, message, issues?)` can be **thrown in handlers with app-defined codes**,
  which survive the IPC boundary — renderers branch on `err.code`, not message strings.

### Fixes

- **Cross-window stream collision**: stream ids are random and main keys active streams per
  sender, so two windows streaming the same member can no longer abort each other (and a renderer
  can only cancel its own streams).

### Testing

- `createCaller(router, { ctx })` — call procedures in-process (validation + middleware included)
  with no electron, throwing `ConveyorError` on failure. Exported from `/define` and `/main`.

## 0.3.0

v2 package API: `initConveyor` app context, middleware chains, streams, Standard Schema
validation, cross-window stores, window manager. Published from the `overhaul/conveyor-v2` branch.
