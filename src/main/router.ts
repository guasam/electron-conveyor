import { ipcMain, BrowserWindow } from 'electron'
import { dispatchProcedure } from '../core/dispatch'
import { registerStreamHandlers } from './stream'
import type { AnyModule, AppCtxOf, BaseContext, ModuleMap, Router } from '../core/types'
import { isDev } from './env'

/**
 * How the app supplies its custom context. Required when the modules need a non-empty app-context,
 * optional otherwise — the soundness link: authoring with `initConveyor<AppContext>()` but omitting
 * `createContext` is a compile error, not an `undefined` at runtime. May be sync or async.
 */
export type RouterOptions<TAppCtx> = keyof TAppCtx extends never
  ? { createContext?: (base: BaseContext) => TAppCtx | Promise<TAppCtx> }
  : { createContext: (base: BaseContext) => TAppCtx | Promise<TAppCtx> }

/**
 * Register every module's procedures on main — one `ipcMain.handle` per module (`conveyor:${id}`),
 * dispatched by method. Returns the router value whose *type* the renderer infers its client from.
 */
export function createRouter<TModules extends ModuleMap>(
  modules: TModules,
  ...opts: keyof AppCtxOf<TModules> extends never
    ? [options?: RouterOptions<AppCtxOf<TModules>>]
    : [options: RouterOptions<AppCtxOf<TModules>>]
): Router<TModules> {
  const createContext = (opts[0] as { createContext?: (base: BaseContext) => unknown } | undefined)?.createContext

  const byId = new Map<string, AnyModule>()
  for (const key of Object.keys(modules)) {
    const mod = modules[key]
    registerModule(mod, createContext)
    byId.set(mod.id, mod)
  }
  // Global start/cancel handlers for every stream across these modules.
  registerStreamHandlers(byId, createContext)
  return { modules }
}

function registerModule(mod: AnyModule, createContext?: (base: BaseContext) => unknown): void {
  const channel = `conveyor:${mod.id}`

  ipcMain.handle(channel, async (event, method: string, input: unknown) => {
    const base: BaseContext = {
      event,
      sender: event.sender,
      window: BrowserWindow.fromWebContents(event.sender),
    }
    const ctx = createContext ? { ...base, ...((await createContext(base)) as object) } : base

    const result = await dispatchProcedure(mod, method, input, ctx as BaseContext, isDev)
    if (!result.ok && isDev) {
      console.error(`[conveyor] ${result.error.code}: ${result.error.message}`, result.error.issues ?? '')
    }
    return result
  })
}
