# React Hooks

Conveyor ships React hooks built on [TanStack Query](https://tanstack.com/query), so calling a
procedure comes with caching, loading and error state, and invalidation for free. The hooks are
**optional** — the plain `conveyor` client works anywhere. Use the hooks when you're calling from
React components.

## Setup

`createConveyorHooks` binds the hooks to your typed client. Create the client once and export the
bound hooks alongside it:

```ts
// conveyor/client.ts
import { createConveyorClient, createConveyorHooks } from 'electron-conveyor/renderer'
import type { ConveyorQueryHook, ConveyorMutationHook, ConveyorEventHook } from 'electron-conveyor/renderer'
import type { AppRouter } from './router'

export const conveyor = createConveyorClient<AppRouter>()

const hooks = createConveyorHooks(conveyor)

// Explicit named annotations keep these re-exports portable across the package boundary.
export const useConveyorQuery: ConveyorQueryHook<AppRouter> = hooks.useConveyorQuery
export const useConveyorMutation: ConveyorMutationHook<AppRouter> = hooks.useConveyorMutation
export const useConveyorEvent: ConveyorEventHook<AppRouter> = hooks.useConveyorEvent
```

::: tip Why the explicit type annotations?
Annotating each re-exported hook with its named type (`ConveyorQueryHook<AppRouter>` …) keeps the
public signature stable instead of inlining TanStack Query's internal types across the package
boundary — which otherwise trips TypeScript errors TS2742/TS2883. If you re-export the hooks from
your own module, do the same.
:::

Because these hooks use TanStack Query, wrap your app in a `QueryClientProvider` as usual:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <App />
  </QueryClientProvider>
)
```

## `useConveyorQuery`

Fetch data from a procedure with caching, `isLoading`, `error`, refetch — everything TanStack Query
gives a query. You pass a **query key** and a selector that calls the procedure:

```tsx
import { useConveyorQuery } from '../conveyor/client'

function Version() {
  const { data, isLoading, error } = useConveyorQuery(['app', 'version'], (c) => c.app.version())

  if (isLoading) return <span>…</span>
  if (error) return <span>failed</span>
  return <span>v{data}</span>
}
```

The key is namespaced under `'conveyor'` internally, so your keys won't collide with other queries.
Include any parameters in the key so the cache keys correctly:

```tsx
const { data } = useConveyorQuery(['file', path], (c) => c.file.read(path))
```

You can pass any TanStack Query options as a third argument (`enabled`, `staleTime`, `select`, …) —
`queryKey` and `queryFn` are managed for you. Queries retry once by default.

## `useConveyorMutation`

Run a procedure as a mutation — for writes, commands, anything you trigger imperatively and want to
invalidate queries after:

```tsx
import { useQueryClient } from '@tanstack/react-query'
import { useConveyorMutation } from '../conveyor/client'

function SaveButton({ path, contents }: { path: string; contents: string }) {
  const qc = useQueryClient()

  const save = useConveyorMutation((c, vars: { path: string; contents: string }) => c.file.write(vars), {
    onSuccess: () => qc.invalidateQueries({ queryKey: ['conveyor', 'file', path] }),
  })

  return (
    <button disabled={save.isPending} onClick={() => save.mutate({ path, contents })}>
      Save
    </button>
  )
}
```

The mutator receives the client and your variables; the second argument accepts any TanStack Query
mutation options (`onSuccess`, `onError`, …).

## `useConveyorEvent`

Subscribe to a main → renderer [event](/guide/events) for the lifetime of the component. It selects
the event member and takes a listener:

```tsx
import { useConveyorEvent } from '../conveyor/client'

function FocusRing() {
  const [focused, setFocused] = useState(true)

  useConveyorEvent(
    (c) => c.window.onFocusChange,
    (focused) => setFocused(focused)
  )

  return <div data-focused={focused} />
}
```

The subscription is created once on mount and disposed on unmount. The listener is held in a ref and
always reflects the latest render, so you can safely reference current props and state inside it
without re-subscribing.

## Errors

A failed procedure throws a [`ConveyorError`](/guide/error-handling), which lands in the query's or
mutation's `error`:

```tsx
const { error, isError } = useConveyorQuery(['file', path], (c) => c.file.read(path))

if (isError && error instanceof ConveyorError && error.code === 'INVALID_INPUT') {
  return <FieldErrors issues={error.issues} />
}
```

## Prefer the plain client outside React

For one-off calls in event handlers, effects, or non-component code, skip the hooks and call the
client directly — it's the same typed surface:

```ts
import { conveyor } from '../conveyor/client'

async function onExport() {
  await conveyor.file.write({ path, contents })
}
```
