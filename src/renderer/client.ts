import { channels, STREAM_START, STREAM_CANCEL } from '../core/channels'
import { ConveyorError } from '../core/errors'
import type { ConveyorClient, ConveyorResult, Router, StreamMessage, Unsubscribe } from '../core/types'

/** The minimal, Zod-free surface the preload exposes across the context bridge. */
export interface ConveyorBridge {
  invoke: (channel: string, method: string, ...args: unknown[]) => Promise<unknown>
  subscribe: (channel: string, cb: (payload: unknown) => void) => Unsubscribe
}

declare global {
  interface Window {
    conveyor: ConveyorBridge
  }
}

let streamSeq = 0

/**
 * A single call handle that is both awaitable (procedure → `await`) and async-iterable (stream →
 * `for await`). The router type constrains which is legal per member, so only one path is ever used;
 * this lets the metadata-free Proxy serve both without a per-method registry or a preload change.
 */
function makeCall(bridge: ConveyorBridge, moduleId: string, method: string, args: unknown[]): unknown {
  const channel = channels.procedure(moduleId)

  // Procedure path — invoke once, unwrapping the { ok } envelope.
  let claimed = false
  let promise: Promise<unknown> | undefined
  const invokeProcedure = () => {
    claimed = true
    return (promise ??= bridge.invoke(channel, method, ...args).then((raw) => {
      const res = raw as ConveyorResult<unknown>
      if (res && typeof res === 'object' && 'ok' in res) {
        if (res.ok) return res.data
        throw new ConveyorError(res.error)
      }
      return raw
    }))
  }

  // Procedures fire EAGERLY — a fire-and-forget `conveyor.mod.action()` (no await) still invokes.
  // Deferred one microtask so a synchronous `for await` (stream) can claim the handle first and skip
  // this. Fire-and-forget errors are swallowed here; an explicit await/.then still receives them.
  queueMicrotask(() => {
    if (claimed) return
    void invokeProcedure().catch(() => {})
  })

  return {
    then: (onF: ((v: unknown) => unknown) | null, onR?: ((e: unknown) => unknown) | null) =>
      invokeProcedure().then(onF, onR),
    catch: (onR: (e: unknown) => unknown) => invokeProcedure().catch(onR),
    finally: (onFin: () => void) => invokeProcedure().finally(onFin),
    [Symbol.asyncIterator]: () => {
      claimed = true
      return streamIterator(bridge, moduleId, method, args)
    },
  }
}

/** Push→pull adapter: buffers stream messages from main and hands them out one `next()` at a time. */
function streamIterator(
  bridge: ConveyorBridge,
  moduleId: string,
  method: string,
  args: unknown[]
): AsyncIterator<unknown> {
  const streamId = `${moduleId}.${method}#${++streamSeq}`
  const channel = channels.stream(streamId)

  type Ev = { k: 'value'; v: unknown } | { k: 'error'; e: unknown } | { k: 'done' }
  const queue: Ev[] = []
  const waiters: Array<{ resolve: (r: IteratorResult<unknown>) => void; reject: (e: unknown) => void }> = []
  let finished = false
  let unsub: Unsubscribe = () => {}

  const deliver = (ev: Ev) => {
    const w = waiters.shift()
    if (!w) return void queue.push(ev)
    if (ev.k === 'value') w.resolve({ value: ev.v, done: false })
    else if (ev.k === 'done') w.resolve({ value: undefined, done: true })
    else w.reject(ev.e)
  }

  unsub = bridge.subscribe(channel, (raw) => {
    const msg = raw as StreamMessage
    if (msg.type === 'data') deliver({ k: 'value', v: msg.value })
    else if (msg.type === 'end') {
      finished = true
      unsub()
      deliver({ k: 'done' })
    } else {
      finished = true
      unsub()
      deliver({ k: 'error', e: new ConveyorError(msg.error) })
    }
  })

  bridge.invoke(STREAM_START, streamId, { module: moduleId, method, streamId, input: args[0] })

  const cancel = () => {
    if (finished) return
    finished = true
    unsub()
    bridge.invoke(STREAM_CANCEL, streamId)
  }

  return {
    next() {
      const ev = queue.shift()
      if (ev) {
        if (ev.k === 'value') return Promise.resolve({ value: ev.v, done: false })
        if (ev.k === 'done') return Promise.resolve({ value: undefined, done: true })
        return Promise.reject(ev.e)
      }
      if (finished) return Promise.resolve({ value: undefined, done: true })
      return new Promise<IteratorResult<unknown>>((resolve, reject) => waiters.push({ resolve, reject }))
    },
    return(value?: unknown) {
      cancel()
      return Promise.resolve({ value, done: true } as IteratorResult<unknown>)
    },
    throw(err?: unknown) {
      cancel()
      return Promise.reject(err)
    },
  }
}

/**
 * Build the typed renderer client — a Proxy over `window.conveyor` carrying no runtime method
 * metadata, so the router (schemas + handlers) stays 100% in main. Each member is a callable (also
 * carrying `.subscribe` for events); the inferred type exposes only the correct shape per member.
 */
export function createConveyorClient<TRouter extends Router>(): ConveyorClient<TRouter> {
  const bridge = window.conveyor
  const moduleCache = new Map<string, unknown>()

  return new Proxy({} as ConveyorClient<TRouter>, {
    get(_target, moduleId) {
      if (typeof moduleId !== 'string') return undefined
      const cached = moduleCache.get(moduleId)
      if (cached) return cached

      const methodCache = new Map<string, unknown>()

      const moduleProxy = new Proxy(
        {},
        {
          get(_t, method) {
            if (typeof method !== 'string') return undefined
            const hit = methodCache.get(method)
            if (hit) return hit

            const member = (...args: unknown[]) => makeCall(bridge, moduleId, method, args)
            member.subscribe = (listener: (payload: unknown) => void): Unsubscribe =>
              bridge.subscribe(channels.event(moduleId, method), listener)

            methodCache.set(method, member)
            return member
          },
        }
      )

      moduleCache.set(moduleId, moduleProxy)
      return moduleProxy
    },
  })
}
