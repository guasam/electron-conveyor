import { BrowserWindow, ipcMain } from 'electron'
import { channels, STORE_GET } from '../core/channels'
import type { StoreActions, StoreDef } from '../authoring/store'

type DropFirst<T extends unknown[]> = T extends [unknown, ...infer R] ? R : never

export interface StoreHandle<S, A extends StoreActions<S>> {
  getState: () => S
  dispatch: <K extends keyof A>(action: K, ...args: DropFirst<Parameters<A[K]>>) => void
}

/**
 * Register a store on main as the single source of truth: holds state, runs actions, and broadcasts
 * every change to all windows. Returns a handle so main code can read/dispatch too.
 */
export function registerStore<TId extends string, S, A extends StoreActions<S>>(
  def: StoreDef<TId, S, A>
): StoreHandle<S, A> {
  const channel = channels.store(def.id)
  const changed = channels.storeChanged(def.id)
  const state = structuredClone(def.initialState) as S
  const actions = def.actions as StoreActions<S>

  const broadcast = () => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(changed, state)
    }
  }

  const run = (name: string, args: unknown[]) => {
    const action = actions[name]
    if (!action) throw new Error(`[conveyor] Unknown store action: ${def.id}.${name}`)
    action(state, ...(args as never[]))
    broadcast()
  }

  ipcMain.handle(channel, (_event, method: string, payload?: { args?: unknown[] }) => {
    if (method === STORE_GET) return state
    run(method, payload?.args ?? [])
    return state
  })

  return {
    getState: () => state,
    dispatch: (name, ...args) => run(name as string, args as unknown[]),
  }
}
