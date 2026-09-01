import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createConveyorClient } from './client'
import { ConveyorError } from '../core/errors'
import type { ConveyorBridge } from './client'
import type { Router, RouterManifest, StreamMessage } from '../core/types'

// Minimal router shape for typing; the client is a Proxy and carries no runtime metadata
// beyond the kind manifest served by the mocked bridge.
type TestRouter = Router

const manifest: RouterManifest = {
  web: { openUrl: 'command' },
  window: { close: 'command', minimize: 'command', onFocusChange: 'event' },
  file: { read: 'query' },
  chat: { respond: 'stream' },
}

function mockBridge(invoke: ConveyorBridge['invoke']) {
  const subscribe = vi.fn<ConveyorBridge['subscribe']>(() => () => {})
  const bridge: ConveyorBridge = { invoke, subscribe, manifest: vi.fn(() => manifest) }
  ;(globalThis as unknown as { window: { conveyor: ConveyorBridge } }).window = { conveyor: bridge }
  return bridge
}

describe('createConveyorClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('marshals a call into invoke(channel, method, ...args) and unwraps { ok }', async () => {
    const invoke = vi.fn(async () => ({ ok: true, data: 'HI' }))
    mockBridge(invoke as unknown as ConveyorBridge['invoke'])

    const client = createConveyorClient<TestRouter>() as never as {
      web: { openUrl: (u: string) => Promise<string> }
    }
    const result = await client.web.openUrl('x')

    expect(result).toBe('HI')
    expect(invoke).toHaveBeenCalledWith('conveyor:web', 'openUrl', 'x')
  })

  it('fetches the manifest lazily, once, and calls return real Promises', async () => {
    const invoke = vi.fn(async () => ({ ok: true, data: null }))
    const bridge = mockBridge(invoke as unknown as ConveyorBridge['invoke'])

    const client = createConveyorClient<TestRouter>() as never as {
      window: { close: () => Promise<void>; minimize: () => Promise<void> }
    }
    expect(bridge.manifest).not.toHaveBeenCalled()

    const p = client.window.close() // fire-and-forget invokes immediately (no microtask deferral)
    expect(p).toBeInstanceOf(Promise)
    expect(invoke).toHaveBeenCalledWith('conveyor:window', 'close')

    await client.window.minimize()
    expect(bridge.manifest).toHaveBeenCalledTimes(1)
  })

  it('throws UNKNOWN_PROCEDURE synchronously for a member the router does not have', () => {
    mockBridge((async () => ({ ok: true, data: null })) as unknown as ConveyorBridge['invoke'])
    const client = createConveyorClient<TestRouter>() as never as Record<string, Record<string, () => unknown>>
    expect(() => client.window.typo()).toThrowError(ConveyorError)
    expect(() => client.nope.anything()).toThrowError(/Unknown conveyor member: nope.anything/)
  })

  it('throws a ConveyorError carrying code + issues on { ok: false }', async () => {
    const invoke = vi.fn(async () => ({
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'bad', issues: [{ path: ['x'] }] },
    }))
    mockBridge(invoke as unknown as ConveyorBridge['invoke'])

    const client = createConveyorClient<TestRouter>() as never as {
      file: { read: (p: string) => Promise<string> }
    }

    await expect(client.file.read('p')).rejects.toMatchObject({
      name: 'ConveyorError',
      code: 'INVALID_INPUT',
      message: 'bad',
    })
    await expect(client.file.read('p')).rejects.toBeInstanceOf(ConveyorError)
  })

  it('caches module + method members for referential stability', () => {
    mockBridge((async () => ({ ok: true, data: null })) as unknown as ConveyorBridge['invoke'])
    const client = createConveyorClient<TestRouter>() as never as Record<string, Record<string, unknown>>
    expect(client.window).toBe(client.window)
    expect(client.window.minimize).toBe(client.window.minimize)
  })

  it('wires .subscribe to the event channel and rejects subscribing to a non-event', () => {
    const bridge = mockBridge((async () => ({ ok: true, data: null })) as unknown as ConveyorBridge['invoke'])
    const client = createConveyorClient<TestRouter>() as never as {
      window: {
        onFocusChange: { subscribe: (cb: (p: boolean) => void) => () => void }
        close: { subscribe: (cb: (p: unknown) => void) => () => void }
      }
    }
    const cb = () => {}
    client.window.onFocusChange.subscribe(cb)
    expect(bridge.subscribe).toHaveBeenCalledWith('conveyor:event:window:onFocusChange', cb)
    expect(() => client.window.close.subscribe(() => {})).toThrowError(/is a command, not an event/)
  })

  it('iterates a stream: STREAM_START, pushed chunks, end — and cancel on early return', async () => {
    const pushes = new Map<string, (payload: unknown) => void>()
    let endStream = true
    const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === 'conveyor:stream:start') {
        const [streamId, req] = args as [string, { input: unknown }]
        const push = pushes.get(`conveyor:stream:${streamId}`)!
        for (const token of ['a', 'b', 'c']) push({ type: 'data', value: `${req.input}:${token}` } as StreamMessage)
        if (endStream) push({ type: 'end' } as StreamMessage)
      }
      return undefined
    })
    const bridge = mockBridge(invoke as unknown as ConveyorBridge['invoke'])
    ;(bridge.subscribe as ReturnType<typeof vi.fn>).mockImplementation(
      (channel: string, cb: (payload: unknown) => void) => {
        pushes.set(channel, cb)
        return () => pushes.delete(channel)
      }
    )

    const client = createConveyorClient<TestRouter>() as never as {
      chat: { respond: (q: string) => AsyncIterable<string> }
    }

    const seen: string[] = []
    for await (const chunk of client.chat.respond('q')) seen.push(chunk)
    expect(seen).toEqual(['q:a', 'q:b', 'q:c'])

    // A break on a still-live stream (no 'end' yet) sends STREAM_CANCEL.
    endStream = false
    invoke.mockClear()
    const invokedChannels = () => invoke.mock.calls.map((c) => c[0])
    for await (const chunk of client.chat.respond('q')) {
      void chunk
      break
    }
    expect(invokedChannels()).toContain('conveyor:stream:cancel')
  })

  it('resolves a pending next() as done when return() is called mid-await (Stop button pattern)', async () => {
    // No chunks ever arrive, so next() parks a waiter; return() from another code path must
    // resolve it or the consumer's for-await hangs forever.
    const invoke = vi.fn(async () => undefined)
    const bridge = mockBridge(invoke as unknown as ConveyorBridge['invoke'])
    ;(bridge.subscribe as ReturnType<typeof vi.fn>).mockImplementation(() => () => {})

    const client = createConveyorClient<TestRouter>() as never as {
      chat: { respond: (q: string) => AsyncIterable<string> }
    }
    const iterator = client.chat.respond('q')[Symbol.asyncIterator]()
    const pending = iterator.next()
    await iterator.return?.(undefined)
    await expect(pending).resolves.toEqual({ value: undefined, done: true })
  })

  it('gives concurrent streams of the same member distinct ids', async () => {
    const startedIds: string[] = []
    const invoke = vi.fn(async (channel: string, ...args: unknown[]) => {
      if (channel === 'conveyor:stream:start') startedIds.push(args[0] as string)
      return undefined
    })
    const bridge = mockBridge(invoke as unknown as ConveyorBridge['invoke'])
    ;(bridge.subscribe as ReturnType<typeof vi.fn>).mockImplementation(() => () => {})

    const client = createConveyorClient<TestRouter>() as never as {
      chat: { respond: (q: string) => AsyncIterable<string> }
    }
    client.chat.respond('one')[Symbol.asyncIterator]()
    client.chat.respond('two')[Symbol.asyncIterator]()
    expect(startedIds).toHaveLength(2)
    expect(new Set(startedIds).size).toBe(2)
  })
})
