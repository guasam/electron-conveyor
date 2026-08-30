import { useEffect, useRef } from 'react'
import {
  useMutation,
  useQuery,
  type UseMutationOptions,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult,
} from '@tanstack/react-query'
import { buildClientProxy, createClientCore } from '../renderer/client'
import type {
  AnyCommandDef,
  AnyEventDef,
  AnyQueryDef,
  AnyStreamDef,
  Call,
  ChunkOf,
  EventSubscriber,
  InputOf,
  ModuleRecord,
  PayloadOf,
  ResultOf,
  Router,
} from '../core/types'

export type QueryOpts<T> = Omit<UseQueryOptions<T, Error>, 'queryKey' | 'queryFn'>
export type MutationOpts<TData, TVars> = Omit<UseMutationOptions<TData, Error, TVars>, 'mutationFn'>

export interface StreamHandlers<C> {
  onData: (chunk: C) => void
  onError?: (err: unknown) => void
  onEnd?: () => void
  /** Re-run (cancelling the old stream) when these change. Include `input` if it can change. */
  deps?: readonly unknown[]
}

// Options-object hooks (`useQuery({ input, refetchInterval })`) rather than positional arguments:
// the runtime can't know a member's input arity (that lives only in types), and a single object
// shape keeps the no-input and with-input forms unambiguous at both levels.
type WithInput<I, TRest> = [I] extends [void]
  ? TRest
  : undefined extends I
    ? { input?: I } & TRest
    : { input: I } & TRest

/** A `query(...)` member on the React client: awaitable, plus auto-keyed TanStack Query wiring. */
export type QueryMember<I, R> = Call<I, Promise<R>> & {
  useQuery: [I] extends [void]
    ? (opts?: QueryOpts<R>) => UseQueryResult<R, Error>
    : undefined extends I
      ? (opts?: { input?: I } & QueryOpts<R>) => UseQueryResult<R, Error>
      : (opts: { input: I } & QueryOpts<R>) => UseQueryResult<R, Error>
  /** The derived query key: `['conveyor', module, method, input?]`. */
  key: (input?: I) => readonly unknown[]
  /** Invalidate this query's cache — all inputs when called bare, one entry when given an input. */
  invalidate: (input?: I) => Promise<void>
}

/** A `command(...)` member: awaitable, plus `useMutation` (vars = the command's input). */
export type CommandMember<I, R> = Call<I, Promise<R>> & {
  useMutation: (opts?: MutationOpts<R, I>) => UseMutationResult<R, Error, I>
}

/** A `stream(...)` member: `for await`-able, plus a lifecycle-managed `useStream`. */
export type StreamMember<I, C> = Call<I, AsyncIterable<C>> & {
  useStream: (opts: WithInput<I, StreamHandlers<C>>) => void
}

/** An `event(...)` member: `subscribe` anywhere, `useEvent` for component-lifetime subscriptions. */
export interface EventMember<P> extends EventSubscriber<P> {
  useEvent: (listener: (payload: P) => void) => void
}

// What each kind of def becomes on the React client.
export type ConveyorReactMember<TDef> = TDef extends AnyQueryDef
  ? QueryMember<InputOf<TDef>, ResultOf<TDef>>
  : TDef extends AnyCommandDef
    ? CommandMember<InputOf<TDef>, ResultOf<TDef>>
    : TDef extends AnyStreamDef
      ? StreamMember<InputOf<TDef>, ChunkOf<TDef>>
      : TDef extends AnyEventDef
        ? EventMember<PayloadOf<TDef>>
        : never

type ReactModuleClient<TRecord extends ModuleRecord> = {
  [K in keyof TRecord]: ConveyorReactMember<TRecord[K]>
}

export type ConveyorReactClient<TRouter extends Router> = {
  [M in keyof TRouter['modules']]: ReactModuleClient<TRouter['modules'][M]['record']>
}

/**
 * The structural slice of TanStack's QueryClient that `invalidate()` needs. Structural on purpose:
 * QueryClient carries a `#private` member, so the nominal type from a duplicate install (e.g. a
 * `file:`/linked checkout) would not be assignable even though the object works fine.
 */
export interface QueryInvalidator {
  invalidateQueries(filters: { queryKey: readonly unknown[]; exact?: boolean }): Promise<void>
}

export interface ReactClientOptions {
  /** Enables `member.invalidate()` outside of hooks. Pass the app's QueryClient instance. */
  queryClient?: QueryInvalidator
}

/**
 * The typed React client: every plain call still works (`await conveyor.system.info()`), and each
 * member also carries its hooks — `useQuery`/`useMutation`/`useStream`/`useEvent` — with query keys
 * derived from the call path, so keys are never written by hand and `invalidate()` is typed.
 *
 * @example
 * export const conveyor = createConveyorReactClient<AppRouter>({ queryClient })
 * const stats = conveyor.system.info.useQuery({ refetchInterval: 1500 })
 * const open  = conveyor.web.openUrl.useMutation()
 * conveyor.window.onFocusChange.useEvent(setFocused)
 */
export function createConveyorReactClient<TRouter extends Router>(
  options?: ReactClientOptions
): ConveyorReactClient<TRouter> {
  const core = createClientCore()
  const queryClient = options?.queryClient

  return buildClientProxy<ConveyorReactClient<TRouter>>((moduleId, method) => {
    const argsOf = (input: unknown) => (input === undefined ? [] : [input])

    const member = ((...args: unknown[]) => core.call(moduleId, method, args)) as Record<string, unknown> &
      ((...args: unknown[]) => unknown)

    member.subscribe = (listener: (payload: unknown) => void) => core.subscribe(moduleId, method, listener)

    const key = (input?: unknown): readonly unknown[] =>
      input === undefined ? ['conveyor', moduleId, method] : ['conveyor', moduleId, method, input]
    member.key = key

    member.useQuery = (opts?: { input?: unknown } & QueryOpts<unknown>) => {
      const { input, ...rest } = opts ?? {}
      return useQuery<unknown, Error>({
        queryKey: key(input),
        queryFn: () => core.invoke(moduleId, method, argsOf(input)),
        retry: 1,
        ...rest,
      })
    }

    member.invalidate = (input?: unknown) => {
      if (!queryClient) {
        throw new Error(
          '[conveyor] invalidate() needs the QueryClient — pass it at setup: createConveyorReactClient({ queryClient })'
        )
      }
      return queryClient.invalidateQueries({ queryKey: key(input), exact: input !== undefined })
    }

    member.useMutation = (opts?: MutationOpts<unknown, unknown>) =>
      useMutation<unknown, Error, unknown>({
        mutationFn: (vars) => core.invoke(moduleId, method, argsOf(vars)),
        ...opts,
      })

    member.useEvent = (listener: (payload: unknown) => void) => {
      const listenerRef = useRef(listener)
      listenerRef.current = listener
      useEffect(() => {
        // The event target is stable — subscribe once; the ref keeps the listener current.
        return core.subscribe(moduleId, method, (payload) => listenerRef.current(payload))
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])
    }

    member.useStream = (opts: { input?: unknown } & StreamHandlers<unknown>) => {
      const handlersRef = useRef(opts)
      handlersRef.current = opts
      useEffect(() => {
        let active = true
        const iterator = core.streamIterable(moduleId, method, argsOf(opts.input))[Symbol.asyncIterator]()
        void (async () => {
          try {
            while (active) {
              const { value, done } = await iterator.next()
              if (done) break
              if (active) handlersRef.current.onData(value)
            }
            if (active) handlersRef.current.onEnd?.()
          } catch (err) {
            if (active) handlersRef.current.onError?.(err)
          }
        })()
        return () => {
          active = false
          void iterator.return?.(undefined)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, opts.deps ?? [])
    }

    return member
  })
}
