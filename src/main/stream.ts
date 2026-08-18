import { ipcMain } from 'electron'
import { channels, STREAM_START, STREAM_CANCEL } from '../core/channels'
import { resolveStream } from '../core/dispatch'
import { errorMessage } from '../core/errors'
import { validateSchema } from '../core/standard-schema'
import type { AnyModule, BaseContext, StreamMessage, StreamStartRequest } from '../core/types'
import { buildContext } from './context'
import { isDev } from './env'

// Active streams by id, so `cancel` can abort the matching generator.
const active = new Map<string, AbortController>()

/**
 * Register the two global stream handlers. Called once by `createRouter` with a by-id module lookup
 * and the app's `createContext`. `removeHandler` first so a re-run (multiple routers / HMR) replaces
 * rather than throws.
 */
export function registerStreamHandlers(
  byId: Map<string, AnyModule>,
  createContext?: (base: BaseContext) => unknown
): void {
  ipcMain.removeHandler(STREAM_START)
  ipcMain.removeHandler(STREAM_CANCEL)

  ipcMain.handle(STREAM_START, async (event, _streamId: string, req: StreamStartRequest) => {
    const sender = event.sender
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
    active.set(req.streamId, controller)

    const ctx = await buildContext(event, createContext)
    const setup = await resolveStream(mod, req.method, req.input, ctx, controller.signal)
    if (!setup.ok) {
      active.delete(req.streamId)
      send({ type: 'error', error: setup.error })
      return
    }

    // Pump in the background; the handler resolves immediately.
    void pump(req.streamId, setup.stream, setup.output, controller, send)
  })

  ipcMain.handle(STREAM_CANCEL, (_event, streamId: string) => {
    const controller = active.get(streamId)
    if (controller) {
      controller.abort()
      active.delete(streamId)
    }
  })
}

async function pump(
  streamId: string,
  stream: AsyncIterable<unknown>,
  output: Parameters<typeof validateSchema>[0] | undefined,
  controller: AbortController,
  send: (msg: StreamMessage) => void
): Promise<void> {
  const signal = controller.signal
  try {
    for await (const chunk of stream) {
      if (signal.aborted) return
      if (isDev && output) {
        const r = await validateSchema(output, chunk)
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
    active.delete(streamId)
  }
}
