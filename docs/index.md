---
layout: home

hero:
  name: Conveyor
  text: Type-safe IPC for Electron
  tagline: One source of truth per feature. End-to-end inference. No hand-written client, no magic channel strings.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: What is Conveyor?
      link: /guide/what-is-conveyor
    - theme: alt
      text: View on GitHub
      link: https://github.com/guasam/electron-conveyor

features:
  - icon: 🔒
    title: End-to-end type safety
    details: Define a feature in one file; the renderer client type is inferred from it. A typo in a call is a compile error, not a runtime surprise.
  - icon: 📇
    title: One source of truth
    details: Contract, validation, and handler live together in a module. Adding an IPC call is a single edit — no separate client, preload, and channel constant to keep in sync.
  - icon: ✅
    title: Validated at the boundary
    details: Every input is validated with Zod on the way in (the trust boundary); outputs are checked in development. Failures cross the wire as a typed ConveyorError.
  - icon: 📡
    title: Push events, typed
    details: Main-to-renderer pushes are declared alongside procedures and consumed with a typed subscribe or a React hook. Fan out to one window, all windows, or all-but-the-sender.
  - icon: 🔄
    title: Cross-window state
    details: Define a store once with pure reducers. Main owns the state; every window mirrors it live and stays in sync automatically.
  - icon: 🪶
    title: Tiny preload, no leakage
    details: The renderer imports only a type. No main-process runtime ever enters the renderer bundle, and the context-bridge surface is just two functions.
---
