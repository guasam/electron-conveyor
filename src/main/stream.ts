import { ipcMain } from 'electron'
import { channels, STREAM_START, STREAM_CANCEL } from '../core/channels'
import { resolveStream } from '../core/dispatch'
import { errorMessage } from '../core/errors'
import { validateSchema } from '../core/standard-schema'
import type { AnyMiddleware, AnyModule, BaseContext, StreamMessage, StreamStartRequest } from '../core/types'
import { buildContext } from './context'
import { isDev } from './env'

// Active streams keyed by `${sender.id}:${streamId}` — the sender scoping means ids from different
// windows can never collide, and a renderer can only ever cancel its own streams.
const active = new Map<string, AbortController>()

/**
 * Register the two global stream handlers. Called once by `createRouter` with a by-id module lookup
 * and the app's `createContext`. `removeHandler` first so a re-run (multiple routers / HMR) replaces
 * rather than throws.
 */
export function registerStreamHandlers(
  byId: Map<string, AnyModule>,
  createContext: ((base: BaseContext) => unknown) | undefined,
  globals: readonly AnyMiddleware[] = []
): void {
  ipcMain.removeHandler(STREAM_START)
  ipcMain.removeHandler(STREAM_CANCEL)

  ipcMain.handle(STREAM_START, async (event, _streamId: string, req: StreamStartRequest) => {
    const sender = event.sender
    const key = `${sender.id}:${req.streamId}`
    const channel = channels.stream(req.streamId)
    const send = (msg: StreamMessage) => {
      if (!sender.isDestroyed()) sender.send(channel, msg)
    }

    const mod = byId.get(req.module)
    if (!mod) {
      send({ type: 'error', error: { code: 'UNKNOWN_PROCEDURE', message: `Unknown module: ${req.module}` } })
      return
    }

    const controller = new AbortController()
    active.set(key, controller)

    const ctx = await buildContext(event, createContext)
    const setup = await resolveStream(mod, req.method, req.input, ctx, controller.signal, globals)
    if (!setup.ok) {
      active.delete(key)
      send({ type: 'error', error: setup.error })
      return
    }

    // Pump in the background; the handler resolves immediately.
    void pump(key, setup.stream, setup.returns, controller, send)
  })

  ipcMain.handle(STREAM_CANCEL, (event, streamId: string) => {
    const key = `${event.sender.id}:${streamId}`
    const controller = active.get(key)
    if (controller) {
      controller.abort()
      active.delete(key)
    }
  })
}

async function pump(
  key: string,
  stream: AsyncIterable<unknown>,
  returns: Parameters<typeof validateSchema>[0] | undefined,
  controller: AbortController,
  send: (msg: StreamMessage) => void
): Promise<void> {
  const signal = controller.signal
  try {
    for await (const chunk of stream) {
      if (signal.aborted) return
      if (isDev && returns) {
        const r = await validateSchema(returns, chunk)
        if (r.issues) {
          send({ type: 'error', error: { code: 'INVALID_OUTPUT', message: `Invalid stream chunk`, issues: r.issues } })
          return
        }
      }
      send({ type: 'data', value: chunk })
    }
    if (!signal.aborted) send({ type: 'end' })
  } catch (err) {
    if (!signal.aborted) send({ type: 'error', error: { code: 'HANDLER_ERROR', message: errorMessage(err) } })
  } finally {
    active.delete(key)
  }
}
