import { ipcMain } from 'electron'
import { channels, MANIFEST } from '../core/channels'
import { dispatchProcedure } from '../core/dispatch'
import { buildManifest } from '../core/manifest'
import { buildContext } from './context'
import { registerStreamHandlers } from './stream'
import { registerStore, type StoreHandle } from './store-main'
import type { AnyStoreDef, StoreDef } from '../authoring/store'
import type { AnyMiddleware, AnyModule, AppCtxOf, BaseContext, Middleware, ModuleMap, Router } from '../core/types'
import { isDev } from './env'

/** Typed handles for the stores a router registered, keyed by store id. */
export type StoreHandlesOf<TStores extends readonly AnyStoreDef[]> = {
  [D in TStores[number] as D['id']]: D extends StoreDef<string, infer S, infer A> ? StoreHandle<S, A> : never
}

interface RouterConfig<TAppCtx extends object, TStores extends readonly AnyStoreDef[]> {
  /**
   * How the app supplies its custom context. Required when the modules need a non-empty
   * app-context, optional otherwise — the soundness link: authoring with `initConveyor<AppContext>()`
   * but omitting `createContext` is a compile error, not an `undefined` at runtime. May be async.
   */
  createContext?: (base: BaseContext) => TAppCtx | Promise<TAppCtx>
  /** Cross-window stores to register alongside the modules (main becomes their source of truth). */
  stores?: TStores
  /** Router-global middleware, run before each def's own chain (e.g. `use: [devLogger]`). */
  use?: ReadonlyArray<Middleware<BaseContext & TAppCtx, object>>
}

export type RouterOptions<TAppCtx extends object, TStores extends readonly AnyStoreDef[]> =
  keyof TAppCtx extends never
    ? RouterConfig<TAppCtx, TStores>
    : RouterConfig<TAppCtx, TStores> & { createContext: (base: BaseContext) => TAppCtx | Promise<TAppCtx> }

/**
 * Register the app's whole IPC surface on main: every module's procedures/streams (one
 * `ipcMain.handle` per module, `conveyor:${key}`, dispatched by method), the kind manifest the
 * renderer client bootstraps from, and any cross-window stores. Module ids come from the keys of
 * `modules`. Returns the router value whose *type* the renderer infers its client from, plus typed
 * `stores` handles so main code can read/dispatch store state too.
 */
export function createRouter<TModules extends ModuleMap, const TStores extends readonly AnyStoreDef[] = readonly []>(
  modules: TModules,
  ...opts: keyof AppCtxOf<TModules> extends never
    ? [options?: RouterOptions<AppCtxOf<TModules>, TStores>]
    : [options: RouterOptions<AppCtxOf<TModules>, TStores>]
): Router<TModules> & { stores: StoreHandlesOf<TStores> } {
  const options = opts[0] as RouterConfig<object, TStores> | undefined
  const createContext = options?.createContext as ((base: BaseContext) => unknown) | undefined
  const globals = (options?.use ?? []) as unknown as readonly AnyMiddleware[]

  const byId = new Map<string, AnyModule>()
  for (const key of Object.keys(modules)) {
    const mod = modules[key]
    if (mod.id !== undefined && mod.id !== key) {
      throw new Error(`[conveyor] module already registered as '${mod.id}' — cannot re-register as '${key}'`)
    }
    mod.id = key
    registerModule(mod, createContext, globals)
    byId.set(key, mod)
  }

  // Global start/cancel handlers for every stream across these modules.
  registerStreamHandlers(byId, createContext, globals)

  // Kind manifest — served synchronously so the renderer client can bootstrap before its first call.
  const manifest = buildManifest(modules)
  ipcMain.removeAllListeners(MANIFEST)
  ipcMain.on(MANIFEST, (event) => {
    event.returnValue = manifest
  })

  const stores = {} as Record<string, unknown>
  for (const store of options?.stores ?? []) stores[store.id] = registerStore(store)

  return { modules, stores: stores as StoreHandlesOf<TStores> }
}

function registerModule(
  mod: AnyModule,
  createContext: ((base: BaseContext) => unknown) | undefined,
  globals: readonly AnyMiddleware[]
): void {
  const channel = channels.procedure(mod.id!)
  ipcMain.removeHandler(channel) // HMR-safe: a re-run replaces rather than throws
  ipcMain.handle(channel, async (event, method: string, input: unknown) => {
    const ctx = await buildContext(event, createContext)
    const result = await dispatchProcedure(mod, method, input, ctx, isDev, globals)
    if (!result.ok && isDev) {
      console.error(`[conveyor] ${result.error.code}: ${result.error.message}`, result.error.issues ?? '')
    }
    return result
  })
}
