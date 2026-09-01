import { channels, STREAM_START, STREAM_CANCEL } from '../core/channels'
import { ConveyorError } from '../core/errors'
import type {
  ConveyorClient,
  ConveyorResult,
  MemberKind,
  Router,
  RouterManifest,
  StreamMessage,
  Unsubscribe,
} from '../core/types'

/** The minimal, schema-free surface the preload exposes across the context bridge. */
export interface ConveyorBridge {
  invoke: (channel: string, method: string, ...args: unknown[]) => Promise<unknown>
  subscribe: (channel: string, cb: (payload: unknown) => void) => Unsubscribe
  /** Fetch the router's kind manifest (synchronous; called once, lazily, then cached). */
  manifest: () => RouterManifest
}

declare global {
  interface Window {
    conveyor: ConveyorBridge
  }
}

/**
 * The kind-aware call machinery shared by the plain client and the React client. The manifest
 * (member kinds only — schemas and handlers never leave main) is fetched synchronously on the
 * first call and cached, which is what lets each member return the real thing — a Promise for
 * queries/commands, an AsyncIterable for streams — instead of a dual-purpose handle, and lets a
 * typo'd member name fail fast with UNKNOWN_PROCEDURE right at the call site.
 */
export interface ClientCore {
  bridge: ConveyorBridge
  kindOf(moduleId: string, method: string): MemberKind
  /** Dispatch by kind: query/command → Promise, stream → AsyncIterable, event → throws (use subscribe). */
  call(moduleId: string, method: string, args: unknown[]): unknown
  invoke(moduleId: string, method: string, args: unknown[]): Promise<unknown>
  streamIterable(moduleId: string, method: string, args: unknown[]): AsyncIterable<unknown>
  subscribe(moduleId: string, method: string, listener: (payload: unknown) => void): Unsubscribe
}

export function createClientCore(): ClientCore {
  const bridge = window.conveyor
  if (!bridge) {
    throw new Error('[conveyor] window.conveyor is missing — call exposeConveyor() in your preload script')
  }

  let manifest: RouterManifest | undefined
  const kindOf = (moduleId: string, method: string): MemberKind => {
    manifest ??= bridge.manifest()
    const kind = manifest[moduleId]?.[method]
    if (!kind) throw new ConveyorError('UNKNOWN_PROCEDURE', `Unknown conveyor member: ${moduleId}.${method}`)
    return kind
  }

  const invoke = async (moduleId: string, method: string, args: unknown[]): Promise<unknown> => {
    const raw = await bridge.invoke(channels.procedure(moduleId), method, ...args)
    const res = raw as ConveyorResult<unknown>
    if (res && typeof res === 'object' && 'ok' in res) {
      if (res.ok) return res.data
      throw ConveyorError.from(res.error)
    }
    return raw
  }

  const streamIterable = (moduleId: string, method: string, args: unknown[]): AsyncIterable<unknown> => ({
    [Symbol.asyncIterator]: () => streamIterator(bridge, moduleId, method, args),
  })

  const call = (moduleId: string, method: string, args: unknown[]): unknown => {
    const kind = kindOf(moduleId, method)
    if (kind === 'stream') return streamIterable(moduleId, method, args)
    if (kind === 'event') {
      throw new ConveyorError('HANDLER_ERROR', `${moduleId}.${method} is an event — use .subscribe()`)
    }
    return invoke(moduleId, method, args)
  }

  const subscribe = (moduleId: string, method: string, listener: (payload: unknown) => void): Unsubscribe => {
    const kind = kindOf(moduleId, method)
    if (kind !== 'event') {
      throw new ConveyorError('HANDLER_ERROR', `${moduleId}.${method} is a ${kind}, not an event — call it instead`)
    }
    return bridge.subscribe(channels.event(moduleId, method), listener)
  }

  return { bridge, kindOf, call, invoke, streamIterable, subscribe }
}

/** The lazy two-level Proxy shared by both clients: `createMember` runs once per `module.method`. */
export function buildClientProxy<TClient extends object>(
  createMember: (moduleId: string, method: string) => unknown
): TClient {
  const moduleCache = new Map<string, unknown>()
  return new Proxy({} as TClient, {
    get(_target, moduleId) {
      if (typeof moduleId !== 'string') return undefined
      let mod = moduleCache.get(moduleId)
      if (!mod) {
        const methodCache = new Map<string, unknown>()
        mod = new Proxy(
          {},
          {
            get(_m, method) {
              if (typeof method !== 'string') return undefined
              let member = methodCache.get(method)
              if (!member) {
                member = createMember(moduleId, method)
                methodCache.set(method, member)
              }
              return member
            },
          }
        )
        moduleCache.set(moduleId, mod)
      }
      return mod
    },
  })
}

/**
 * Build the typed renderer client — a Proxy over `window.conveyor` carrying no runtime method
 * metadata beyond the kind manifest. Queries/commands return real Promises; streams return
 * AsyncIterables (cancel by breaking out / `iterator.return()`); events expose `.subscribe()`.
 *
 * @example const conveyor = createConveyorClient<AppRouter>()
 */
export function createConveyorClient<TRouter extends Router>(): ConveyorClient<TRouter> {
  const core = createClientCore()
  return buildClientProxy<ConveyorClient<TRouter>>((moduleId, method) => {
    const member = (...args: unknown[]) => core.call(moduleId, method, args)
    member.subscribe = (listener: (payload: unknown) => void) => core.subscribe(moduleId, method, listener)
    return member
  })
}

/** Push→pull adapter: buffers stream messages from main and hands them out one `next()` at a time. */
function streamIterator(
  bridge: ConveyorBridge,
  moduleId: string,
  method: string,
  args: unknown[]
): AsyncIterator<unknown> {
  // Random ids so concurrent calls — including the same call from two windows — can never collide.
  const streamId = `${moduleId}.${method}#${crypto.randomUUID()}`
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
      deliver({ k: 'error', e: ConveyorError.from(msg.error) })
    }
  })

  void bridge.invoke(STREAM_START, streamId, { module: moduleId, method, streamId, input: args[0] })

  const cancel = () => {
    if (finished) return
    finished = true
    unsub()
    void bridge.invoke(STREAM_CANCEL, streamId)
    // A consumer may be parked in next() right now (the Stop-button pattern: one code path awaits
    // while another calls return()) — resolve it as done or that await hangs forever.
    for (const w of waiters.splice(0)) w.resolve({ value: undefined, done: true })
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
