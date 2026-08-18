import { BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import type { BaseContext } from '../core/types'

/**
 * Build a handler context from an invoke event: the base electron fields (always present, resolving
 * the *calling* window) plus the app's custom context merged on top. Shared by the procedure and
 * stream handlers so the merge lives in one place.
 */
export async function buildContext(
  event: IpcMainInvokeEvent,
  createContext?: (base: BaseContext) => unknown
): Promise<BaseContext> {
  const base: BaseContext = {
    event,
    sender: event.sender,
    window: BrowserWindow.fromWebContents(event.sender),
  }
  return (createContext ? { ...base, ...((await createContext(base)) as object) } : base) as BaseContext
}
