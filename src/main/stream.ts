import { ipcMain, BrowserWindow, type WebContents } from 'electron'
import { resolveStream } from '../core/dispatch'
import { validateSchema } from '../core/standard-schema'
import type { AnyModule, BaseContext, StreamMessage, StreamStartRequest } from '../core/types'
import { isDev } from './env'

const START = 'conveyor:stream:start'
const CANCEL = 'conveyor:stream:cancel'

// Active streams by id, so `cancel` can abort the matching generator.
const active = new Map<string, AbortController>()

const errMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/**
 * Register the two global stream handlers. Called once by `createRouter` with a by-id module lookup
 * and the app's `createContext`. `removeHandler` first so a re-run (multiple routers / HMR) replaces
 * rather than throws.
 */
export function registerStreamHandlers(
  byId: Map<string, AnyModule>,
  createContext?: (base: BaseContext) => unknown
): void {
  ipcMain.removeHandler(START)
  ipcMain.removeHandler(CANCEL)

  ipcMain.handle(START, async (event, _streamId: string, req: StreamStartRequest) => {
    const sender = event.sender
    const channel = `conveyor:stream:${req.streamId}`
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

    const base: BaseContext = {
      event,
      sender,
      window: BrowserWindow.fromWebContents(sender),
    }
    const ctx = createContext ? { ...base, ...((await createContext(base)) as object) } : base

    const setup = await resolveStream(mod, req.method, req.input, ctx as BaseContext, controller.signal)
    if (!setup.ok) {
      active.delete(req.streamId)
      send({ type: 'error', error: setup.error })
      return
    }

    // Pump in the background; the handler resolves immediately.
    void pump(req.streamId, setup.stream, setup.output, controller, send)
  })

  ipcMain.handle(CANCEL, (_event, streamId: string) => {
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
    if (!signal.aborted) send({ type: 'error', error: { code: 'HANDLER_ERROR', message: errMessage(err) } })
  } finally {
    active.delete(streamId)
  }
}
