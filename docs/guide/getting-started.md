# Getting Started

This walks through wiring Conveyor into an Electron app end to end: install, author a feature,
register it in main, bridge it in preload, and call it from the renderer — fully typed.

## Installation

::: code-group

```sh [npm]
npm install electron-conveyor zod
```

```sh [pnpm]
pnpm add electron-conveyor zod
```

```sh [yarn]
yarn add electron-conveyor zod
```

:::

Conveyor targets **Electron 30+** and needs **Zod 4**. React, `@tanstack/react-query`, and Zustand
are optional — install them only if you use the [React hooks](/guide/react-hooks) or
[cross-window stores](/guide/stores).

## Import map

Conveyor ships one entry point per process, so each side of your app imports from exactly one
place:

```ts
// authoring — pure, safe to import in ANY process
import { defineModule, procedure, event, defineStore } from 'electron-conveyor/define'

// main process only
import { createRouter, createEmitter, registerStore, createWindowManager } from 'electron-conveyor/main'

// renderer process only
import { createConveyorClient, createConveyorHooks, useConveyorStore } from 'electron-conveyor/renderer'

// preload only
import { exposeConveyor } from 'electron-conveyor/preload'
```

The split is enforced by design: authoring primitives are pure, and the main-only entry pulls in
`electron`. See [The Process Boundary](/guide/process-boundary) for the rules that keep the
renderer bundle clean.

## 1. Author a module

A **module** groups related procedures (and events) under a namespace id. This is the single source
of truth for a feature — contract, validation, and handler all in one place.

```ts
// conveyor/modules/app.ts
import { app } from 'electron'
import { z } from 'zod'
import { defineModule, procedure } from 'electron-conveyor/define'

export const appModule = defineModule('app', {
  version: procedure()
    .output(z.string())
    .handle(() => app.getVersion()),
})
```

## 2. Create the router (main)

Combine every module into a **router** and export its *type*. The router value is registered in
main; the type is the only thing the renderer will ever import.

```ts
// conveyor/router.ts
import { createRouter } from 'electron-conveyor/main'
import { appModule } from './modules/app'

export const router = createRouter({
  app: appModule,
})

// The ONLY thing the renderer imports from this file.
export type AppRouter = typeof router
```

`createRouter` registers one `ipcMain.handle` per module the moment this file is evaluated, so make
sure it is imported somewhere in your main process startup path.

## 3. Bridge it in preload

The preload exposes a tiny, Zod-free bridge (`invoke` + `subscribe`) over the context bridge. The
typed client is built on top of it renderer-side.

```ts
// preload.ts
import { exposeConveyor } from 'electron-conveyor/preload'

exposeConveyor()
```

Point your `BrowserWindow`'s `webPreferences.preload` at the compiled preload file as usual.

## 4. Create the renderer client

Instantiate the client with your router type. This is where inference happens — the client's shape
comes entirely from `AppRouter`.

```ts
// conveyor/client.ts
import { createConveyorClient } from 'electron-conveyor/renderer'
// Type-only import — erased at build, so no main runtime enters the renderer bundle.
import type { AppRouter } from './router'

export const conveyor = createConveyorClient<AppRouter>()
```

## 5. Call it — fully typed

```ts
// anywhere in the renderer
import { conveyor } from './conveyor/client'

const version = await conveyor.app.version() // inferred: string
```

No client code was written for `app.version`. Rename it in the module, change its output schema, or
delete it, and this call stops compiling.

## Where to go next

- **Return data, accept input, validate it** → [Procedures](/guide/procedures)
- **Push from main to the renderer** → [Events](/guide/events)
- **Share reactive state across windows** → [Stores](/guide/stores)
- **Use it from React with caching** → [React Hooks](/guide/react-hooks)

## A note on this repo's example app

The [`electron-react-app`](https://github.com/guasam/electron-react-app) starter wires Conveyor in
exactly this shape: modules under `conveyor/modules`, a `conveyor/router.ts`, `exposeConveyor()` in
the preload, and a `conveyor/client.ts` in the renderer. It's a working reference if you'd like to
see all the pieces in one place.
