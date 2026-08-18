import {
  useMutation,
  useQuery,
  type UseMutationOptions,
  type UseMutationResult,
  type UseQueryOptions,
  type UseQueryResult,
} from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import type { ConveyorClient, Router, Unsubscribe } from '../core/types'

type QueryOpts<T> = Omit<UseQueryOptions<T, Error>, 'queryKey' | 'queryFn'>
type MutationOpts<TData, TVars> = Omit<UseMutationOptions<TData, Error, TVars>, 'mutationFn'>

interface Subscribable<P> {
  subscribe: (listener: (payload: P) => void) => Unsubscribe
}

/**
 * The bound conveyor hooks, declared explicitly (not inferred) so consumers can re-export them
 * portably — an inferred return would leak TanStack Query's internal types across the package
 * boundary and trip TS2742/TS2883.
 */
export interface ConveyorHooks<TRouter extends Router> {
  useConveyorQuery<T>(
    key: readonly unknown[],
    selector: (client: ConveyorClient<TRouter>) => Promise<T>,
    options?: QueryOpts<T>
  ): UseQueryResult<T, Error>
  useConveyorMutation<TData, TVars = void>(
    mutator: (client: ConveyorClient<TRouter>, vars: TVars) => Promise<TData>,
    options?: MutationOpts<TData, TVars>
  ): UseMutationResult<TData, Error, TVars>
  useConveyorEvent<P>(
    selector: (client: ConveyorClient<TRouter>) => Subscribable<P>,
    listener: (payload: P) => void
  ): void
  useConveyorStream<P>(
    selector: (client: ConveyorClient<TRouter>) => AsyncIterable<P>,
    handlers: { onData: (chunk: P) => void; onError?: (err: unknown) => void; onEnd?: () => void },
    deps?: readonly unknown[]
  ): void
}

// Per-hook aliases so consumers can annotate re-exported hooks with a portable, named type.
export type ConveyorQueryHook<TRouter extends Router> = ConveyorHooks<TRouter>['useConveyorQuery']
export type ConveyorMutationHook<TRouter extends Router> = ConveyorHooks<TRouter>['useConveyorMutation']
export type ConveyorEventHook<TRouter extends Router> = ConveyorHooks<TRouter>['useConveyorEvent']
export type ConveyorStreamHook<TRouter extends Router> = ConveyorHooks<TRouter>['useConveyorStream']

/**
 * Bind the conveyor React hooks to a typed client — thin wrappers over TanStack Query and a
 * subscription effect.
 *
 * @example
 * export const conveyor = createConveyorClient<AppRouter>()
 * export const { useConveyorQuery, useConveyorMutation, useConveyorEvent } = createConveyorHooks(conveyor)
 */
export function createConveyorHooks<TRouter extends Router>(client: ConveyorClient<TRouter>): ConveyorHooks<TRouter> {
  type Client = ConveyorClient<TRouter>

  /** Fetch from a procedure with caching/loading/error via TanStack Query. */
  function useConveyorQuery<T>(
    key: readonly unknown[],
    selector: (c: Client) => Promise<T>,
    options?: QueryOpts<T>
  ): UseQueryResult<T, Error> {
    return useQuery<T, Error>({
      queryKey: ['conveyor', ...key],
      queryFn: () => selector(client),
      retry: 1,
      ...options,
    })
  }

  /** Run a procedure as a mutation (invalidate/refetch in `onSuccess`, etc.). */
  function useConveyorMutation<TData, TVars = void>(
    mutator: (c: Client, vars: TVars) => Promise<TData>,
    options?: MutationOpts<TData, TVars>
  ): UseMutationResult<TData, Error, TVars> {
    return useMutation<TData, Error, TVars>({
      mutationFn: (vars) => mutator(client, vars),
      ...options,
    })
  }

  /** Subscribe to a main→renderer push event for the component's lifetime. */
  function useConveyorEvent<P>(selector: (c: Client) => Subscribable<P>, listener: (payload: P) => void): void {
    const listenerRef = useRef(listener)
    listenerRef.current = listener

    useEffect(() => {
      // Event target is stable across renders — subscribe once; the ref keeps the listener current.
      const unsubscribe = selector(client).subscribe((payload) => listenerRef.current(payload))
      return unsubscribe
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  }

  /** Consume a streaming procedure for the component's lifetime; unmount/`deps` change cancels it. */
  function useConveyorStream<P>(
    selector: (c: Client) => AsyncIterable<P>,
    handlers: { onData: (chunk: P) => void; onError?: (err: unknown) => void; onEnd?: () => void },
    deps: readonly unknown[] = []
  ): void {
    const handlersRef = useRef(handlers)
    handlersRef.current = handlers

    useEffect(() => {
      let active = true
      const iterator = selector(client)[Symbol.asyncIterator]()
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
    }, deps)
  }

  return { useConveyorQuery, useConveyorMutation, useConveyorEvent, useConveyorStream }
}
