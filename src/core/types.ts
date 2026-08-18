import type { BrowserWindow, IpcMainInvokeEvent, WebContents } from 'electron'
import type { StandardSchemaV1 } from './standard-schema'

/**
 * Electron fields on every handler ctx, built fresh per invoke so handlers act on the *calling*
 * window. `window` is null for a `<webview>`/offscreen sender. The app's custom context
 * (`initConveyor<AppContext>()` + `createRouter`'s `createContext`) merges on top; middleware widens it.
 */
export interface BaseContext {
  event: IpcMainInvokeEvent
  sender: WebContents
  window: BrowserWindow | null
}

/** @deprecated alias — prefer `BaseContext`. */
export type HandlerContext = BaseContext

/* -- Middleware ---------------------------------------------------- */

// `next()` keeps ctx; `next({ ctx })` merges an extension the handler sees typed. The returned
// marker carries only the added-ctx type (so `.use()` can infer it); at runtime `next` returns
// the real handler result, propagated up the chain.
export interface MwMarker<TAdd> {
  readonly __ctxAdd?: TAdd
}

export interface NextFn {
  (): Promise<MwMarker<object>>
  <TAdd extends object>(opts: { ctx: TAdd }): Promise<MwMarker<TAdd>>
}

export type Middleware<TCtx, TAdd extends object> = (opts: {
  ctx: TCtx
  path: string
  type: 'procedure'
  next: NextFn
}) => Promise<MwMarker<TAdd>>

/** Runtime middleware shape (types erased) stored on a def and run by dispatch. */
export type AnyMiddleware = (opts: {
  ctx: any
  path: string
  type: 'procedure'
  next: (opts?: { ctx?: object }) => Promise<unknown>
}) => Promise<unknown>

/* -- Definitions --------------------------------------------------- */

// `TAppCtx` is what the app's `createContext` must supply (the `initConveyor` parameter), threaded
// onto defs/modules so `createRouter` can demand a matching factory. Distinct from the accumulated
// handler ctx, which middleware widens further.

export interface ProcedureDef<TInput = unknown, TResult = unknown, TAppCtx extends object = object> {
  kind: 'procedure'
  input?: StandardSchemaV1
  output?: StandardSchemaV1
  middlewares?: AnyMiddleware[]
  resolver: (opts: { input: TInput; ctx: any }) => TResult
  readonly _appCtx?: TAppCtx
}

export interface EventDef<TPayload = unknown> {
  kind: 'event'
  payload: StandardSchemaV1
  readonly _payload?: TPayload
}

// `any` generics (not `unknown`) so concrete defs stay assignable despite resolver contravariance.
export type AnyDef = ProcedureDef<any, any, any> | EventDef<any>
export type ModuleRecord = Record<string, AnyDef>

export interface Module<
  TId extends string = string,
  TRecord extends ModuleRecord = ModuleRecord,
  TAppCtx extends object = object,
> {
  id: TId
  record: TRecord
  readonly _appCtx?: TAppCtx
}

export type AnyModule = Module<string, ModuleRecord, any>
export type ModuleMap = Record<string, AnyModule>

export interface Router<TModules extends ModuleMap = ModuleMap> {
  modules: TModules
}

export type Unsubscribe = () => void

/** Recover the app-context required across a module map, so createRouter can demand a matching factory. */
type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void ? I : never

export type AppCtxOf<TModules extends ModuleMap> = UnionToIntersection<
  {
    [K in keyof TModules]: TModules[K] extends Module<any, any, infer C> ? C : never
  }[keyof TModules]
>

/* -- Error transport ----------------------------------------------- */

// Procedures return a typed envelope so real error detail survives the IPC boundary.
export type ConveyorErrorCode = 'UNKNOWN_PROCEDURE' | 'INVALID_INPUT' | 'INVALID_OUTPUT' | 'HANDLER_ERROR'

export interface ConveyorErrorPayload {
  code: ConveyorErrorCode
  message: string
  /** Standard Schema issues for INVALID_INPUT / INVALID_OUTPUT. */
  issues?: unknown
}

export type ConveyorResult<T> = { ok: true; data: T } | { ok: false; error: ConveyorErrorPayload }

/* -- Client inference ---------------------------------------------- */

// Procedures → async method; events → { subscribe }.
type ClientMember<TDef> =
  TDef extends ProcedureDef<infer I, infer R, any>
    ? [I] extends [void]
      ? () => Promise<Awaited<R>>
      : (input: I) => Promise<Awaited<R>>
    : TDef extends EventDef<infer P>
      ? { subscribe: (listener: (payload: P) => void) => Unsubscribe }
      : never

type ModuleClient<TRecord extends ModuleRecord> = {
  [K in keyof TRecord]: ClientMember<TRecord[K]>
}

export type ConveyorClient<TRouter extends Router> = {
  [M in keyof TRouter['modules']]: ModuleClient<TRouter['modules'][M]['record']>
}

/* -- Emitter inference (main) -------------------------------------- */

type EventKeysOf<TRecord extends ModuleRecord> = {
  [K in keyof TRecord]: TRecord[K] extends EventDef ? K : never
}[keyof TRecord]

type EventPayloadOf<TDef> = TDef extends EventDef<infer P> ? P : never

export type EventEmitters<TModule extends AnyModule> = {
  [K in EventKeysOf<TModule['record']>]: (payload: EventPayloadOf<TModule['record'][K]>) => void
}
