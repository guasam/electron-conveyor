import { dispatchProcedure, resolveStream } from './dispatch'
import { ConveyorError } from './errors'
import type {
  AnyEventDef,
  AnyModule,
  AnyStreamDef,
  AppCtxOf,
  BaseContext,
  Call,
  ChunkOf,
  ClientMember,
  InputOf,
  ModuleMap,
  ModuleRecord,
  Router,
} from './types'

// Same surface as the renderer client, with two in-process differences: a stream resolves async
// (input validation + middleware run before the iterable exists), and events have no in-process
// meaning — calling one throws at runtime, so the type maps them to `never`.
type CallerMember<TDef> = TDef extends AnyStreamDef
  ? Call<InputOf<TDef>, Promise<AsyncIterable<ChunkOf<TDef>>>>
  : TDef extends AnyEventDef
    ? never
    : ClientMember<TDef>

type ModuleCaller<TRecord extends ModuleRecord> = {
  [K in keyof TRecord]: CallerMember<TRecord[K]>
}

export type ConveyorCaller<TRouter extends Router> = {
  [M in keyof TRouter['modules']]: ModuleCaller<TRouter['modules'][M]['record']>
}

export interface CallerOptions<TAppCtx extends object> {
  /**
   * The handler context for every call. Electron's base fields default to stubs (`window: null`),
   * so tests inject only what handlers actually read; when the modules declare an app context,
   * its fields are required here (the caller bypasses `createContext`).
   */
  ctx: Partial<BaseContext> & TAppCtx
}

/**
 * Call procedures in-process, without IPC or electron — for main-side code and (especially) tests.
 * Input validation, middleware chains, and `returns` checks run exactly as they would over IPC;
 * failures throw `ConveyorError` instead of returning the wire envelope. Streams resolve to their
 * `AsyncIterable`. Router-global middleware (`createRouter`'s `use`) is not applied.
 *
 * @example
 * const caller = createCaller(router, { ctx: { appStartedAt: 0 } })
 * expect(await caller.system.info()).toMatchObject({ platform: process.platform })
 */
export function createCaller<TModules extends ModuleMap>(
  router: Router<TModules>,
  ...opts: keyof AppCtxOf<TModules> extends never
    ? [options?: { ctx?: Partial<BaseContext> }]
    : [options: CallerOptions<AppCtxOf<TModules>>]
): ConveyorCaller<Router<TModules>> {
  const ctx = {
    event: undefined as never,
    sender: undefined as never,
    window: null,
    ...(opts[0]?.ctx as object | undefined),
  } as BaseContext

  const call = async (mod: AnyModule, method: string, input: unknown): Promise<unknown> => {
    const def = mod.record[method]
    if (def?.kind === 'event')
      throw new ConveyorError('HANDLER_ERROR', `${mod.id}.${method} is an event — emit it via createEmitter`)
    if (def?.kind === 'stream') {
      const setup = await resolveStream(mod, method, input, ctx, new AbortController().signal)
      if (!setup.ok) throw ConveyorError.from(setup.error)
      return setup.stream
    }
    const result = await dispatchProcedure(mod, method, input, ctx, true)
    if (!result.ok) throw ConveyorError.from(result.error)
    return result.data
  }

  const moduleCache = new Map<string, unknown>()
  return new Proxy({} as ConveyorCaller<Router<TModules>>, {
    get(_t, moduleKey) {
      if (typeof moduleKey !== 'string') return undefined
      const cached = moduleCache.get(moduleKey)
      if (cached) return cached

      const mod = router.modules[moduleKey]
      if (!mod) throw new ConveyorError('UNKNOWN_PROCEDURE', `Unknown module: ${moduleKey}`)
      mod.id ??= moduleKey // usable before createRouter (tests)

      const methods = new Map<string, unknown>()
      const moduleProxy = new Proxy(
        {},
        {
          get(_m, method) {
            if (typeof method !== 'string') return undefined
            let member = methods.get(method)
            if (!member) {
              member = (input?: unknown) => call(mod, method, input)
              methods.set(method, member)
            }
            return member
          },
        }
      )
      moduleCache.set(moduleKey, moduleProxy)
      return moduleProxy
    },
  })
}
