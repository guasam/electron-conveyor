# Stores

A **store** is reactive state that lives in main and stays in sync across **every** window
automatically. Main is the single source of truth; each renderer holds a live mirror. Mutate it
from any window and all windows re-render.

This is the answer to "I have two windows and they need to agree on something" — settings, a
selection, a counter, connection status — without you writing any sync code.

## Define it

A store definition is **pure**: initial state plus action reducers that mutate a draft. No
`electron`, no `react` — which is exactly why the same definition is safe to import in both
processes.

```ts
// conveyor/stores/counter.ts
import { defineStore } from 'electron-conveyor/define'

export const counterStore = defineStore('counter', {
  state: { count: 0, updatedBy: 'init' as string },
  actions: {
    increment: (s, by: number = 1) => {
      s.count += by
      s.updatedBy = 'increment'
    },
    decrement: (s, by: number = 1) => {
      s.count -= by
      s.updatedBy = 'decrement'
    },
    reset: (s) => {
      s.count = 0
      s.updatedBy = 'reset'
    },
  },
})
```

Each action receives the current `state` as its first argument and mutates it in place. Any extra
arguments (`by` above) become the action's public parameters — the `state` argument is dropped from
the client-facing signature.

::: warning Keep actions pure
Actions are state reducers, nothing more. Side effects — file writes, network calls, opening
windows — belong in [procedures](/guide/procedures), not store actions. Purity is what keeps the
definition importable from both processes.
:::

## Register it in main

Registering a store in main makes it the source of truth: it holds the state, runs actions, and
broadcasts every change to all windows. Do this once at startup.

```ts
// conveyor/stores/index.ts
import { registerStore } from 'electron-conveyor/main'
import { counterStore } from './counter'

export function registerStores() {
  return {
    counter: registerStore(counterStore),
  }
}
```

```ts
// main startup
registerStores()
```

`registerStore` returns a **handle** so main-side code can read and drive the store too:

```ts
const { counter } = registerStores()

counter.getState() // { count: 0, updatedBy: 'init' }
counter.dispatch('increment', 5) // typed: action name + its args
```

## Use it in the renderer

`useConveyorStore` subscribes a component to the store. Main owns it; every window mirrors it live.

### Select a slice (the ergonomic default)

Pass a selector to read just one slice — the component re-renders **only** when that slice changes:

```tsx
import { counterStore } from '../conveyor/stores/counter'
import { useConveyorStore, useConveyorActions } from 'electron-conveyor/renderer'

function Counter() {
  const count = useConveyorStore(counterStore, (s) => s.count) // number
  const { increment, decrement, reset } = useConveyorActions(counterStore)

  return (
    <>
      <span>{count}</span>
      <button onClick={() => increment()}>+</button>
      <button onClick={() => decrement()}>−</button>
      <button onClick={reset}>reset</button>
    </>
  )
}
```

Open a second window and increment in either one — both update in lockstep, because the mutation
happens in main and the new state is broadcast to every mirror.

### The whole store

Called without a selector, `useConveyorStore` returns the full state merged with the bound actions.
Convenient, but it re-renders on any change:

```tsx
const counter = useConveyorStore(counterStore)
// { count, updatedBy, increment, decrement, reset }
counter.increment(2)
```

### Actions only

`useConveyorActions` returns just the bound actions. The references are **stable**, so reading them
never causes a re-render — ideal for a component that dispatches but doesn't display state:

```tsx
const { increment } = useConveyorActions(counterStore)
```

## How syncing works

1. On first use in a window, the mirror hydrates from main (`__get__`) and subscribes to change
   broadcasts.
2. Calling a bound action invokes main, which runs the reducer against the source-of-truth state.
3. Main broadcasts the new state to every live window; each mirror updates and re-renders its
   subscribers.

```
window A            main (source of truth)          window B
────────            ──────────────────────          ────────
increment()  ─────► run reducer, mutate state
                    broadcast new state  ──────────► mirror updates → re-render
mirror updates ◄────┘
```

You never write channel strings or listeners — declaring the store and registering it is the whole
setup.
