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
  type: 'query' | 'command' | 'stream'
  next: NextFn
}) => Promise<MwMarker<TAdd>>

/** Runtime middleware shape (types erased) stored on a def and run by dispatch. */
export type AnyMiddleware = (opts: {
  ctx: any
  path: string
  type: 'query' | 'command' | 'stream'
  next: (opts?: { ctx?: object }) => Promise<unknown>
}) => Promise<unknown>

/* -- Definitions --------------------------------------------------- */

/** Renderer→main request/response kinds. `query` reads, `command` acts — they dispatch
 *  identically; the split exists so the client can auto-wire `useQuery` vs `useMutation`. */
export type ProcedureKind = 'query' | 'command'
export type MemberKind = ProcedureKind | 'stream' | 'event'

// `TAppCtx` is what the app's `createContext` must supply (the `initConveyor` parameter), threaded
// onto defs/modules so `createRouter` can demand a matching factory. Distinct from the accumulated
// handler ctx, which middleware widens further.

export interface ProcedureDef<
  TKind extends ProcedureKind = ProcedureKind,
  TInput = unknown,
  TResult = unknown,
  TAppCtx extends object = object,
> {
  kind: TKind
  input?: StandardSchemaV1
  /** Dev-only result check (trusted code — a correctness aid, not security). */
  returns?: StandardSchemaV1
  middlewares?: AnyMiddleware[]
  resolver: (opts: { input: TInput; ctx: any }) => TResult
  readonly _appCtx?: TAppCtx
}

// A renderer→main stream: an async-generator handler whose yields are pushed as they arrive.
// `signal` fires when the renderer stops iterating or its window closes (cooperative cancellation).
export interface StreamDef<TInput = unknown, TChunk = unknown, TAppCtx extends object = object> {
  kind: 'stream'
  input?: StandardSchemaV1
  /** Dev-only per-chunk check. */
  returns?: StandardSchemaV1
  middlewares?: AnyMiddleware[]
  resolver: (opts: { input: TInput; ctx: any; signal: AbortSignal }) => AsyncIterable<TChunk>
  readonly _appCtx?: TAppCtx
}

export interface EventDef<TPayload = unknown> {
  kind: 'event'
  payload: StandardSchemaV1
  /** Phantom: carries the payload type for inference. Never set at runtime. */
  readonly _payload?: TPayload
}

// `any` generics (not `unknown`) so concrete defs stay assignable despite resolver contravariance.
export type AnyDef = ProcedureDef<ProcedureKind, any, any, any> | StreamDef<any, any, any> | EventDef<any>
export type ModuleRecord = Record<string, AnyDef>

export interface Module<TRecord extends ModuleRecord = ModuleRecord, TAppCtx extends object = object> {
  /** Assigned by `createRouter` from the router key — undefined until the module is registered. */
  id?: string
  record: TRecord
  readonly _appCtx?: TAppCtx
}

export type AnyModule = Module<ModuleRecord, any>
export type ModuleMap = Record<string, AnyModule>

export interface Router<TModules extends ModuleMap = ModuleMap> {
  modules: TModules
}

export type Unsubscribe = () => void

/** Recover the app-context required across a module map, so createRouter can demand a matching factory. */
type UnionToIntersection<U> = (U extends unknown ? (k: U) => void : never) extends (k: infer I) => void ? I : never

export type AppCtxOf<TModules extends ModuleMap> = UnionToIntersection<
  {
    [K in keyof TModules]: TModules[K] extends Module<any, infer C> ? C : never
  }[keyof TModules]
> &
  object // the intersection pins the empty/unknown cases back to `object`

/* -- Kind manifest -------------------------------------------------- */

/** What main serves on the MANIFEST channel: member kinds per module, keyed by router key. */
export type RouterManifest = Record<string, Record<string, MemberKind>>

/* -- Error transport ----------------------------------------------- */

// Procedures return a typed envelope so real error detail survives the IPC boundary.

/** Codes conveyor itself produces. Handlers may throw `ConveyorError` with any custom code. */
export type ReservedErrorCode = 'UNKNOWN_PROCEDURE' | 'INVALID_INPUT' | 'INVALID_OUTPUT' | 'HANDLER_ERROR'

export interface ConveyorErrorPayload {
  /** A reserved code, or whatever custom code the handler threw via `ConveyorError`. */
  code: ReservedErrorCode | (string & {})
  message: string
  /** Standard Schema issues for INVALID_INPUT / INVALID_OUTPUT. */
  issues?: unknown
}

/** The full space of codes an error can carry (reserved + app-defined). */
export type ConveyorErrorCode = ConveyorErrorPayload['code']

export type ConveyorResult<T> = { ok: true; data: T } | { ok: false; error: ConveyorErrorPayload }

// Stream transport over the bridge: renderer subscribes to `conveyor:stream:${id}` and invokes
// `conveyor:stream:start` / `:cancel`. Main pushes these messages on the per-call channel.
export interface StreamStartRequest {
  module: string
  method: string
  streamId: string
  input: unknown
}

export type StreamMessage =
  { type: 'data'; value: unknown } | { type: 'error'; error: ConveyorErrorPayload } | { type: 'end' }

/* -- Client inference ---------------------------------------------- */

// A member call takes no argument when its input is `void`, an optional argument when the input
// schema allows `undefined`, otherwise exactly one typed argument. `[I] extends [void]` is
// tuple-wrapped so it tests the whole input type instead of distributing over a union.
export type Call<I, TReturn> = [I] extends [void]
  ? () => TReturn
  : undefined extends I
    ? (input?: I) => TReturn
    : (input: I) => TReturn

// Procedure → Promise of the result; stream → AsyncIterable of the chunk; event → { subscribe }.
export type ClientMember<TDef> =
  TDef extends ProcedureDef<ProcedureKind, infer I, infer R, any>
    ? Call<I, Promise<Awaited<R>>>
    : TDef extends StreamDef<infer I, infer C, any>
      ? Call<I, AsyncIterable<C>>
      : TDef extends EventDef<infer P>
        ? { subscribe: (listener: (payload: P) => void) => Unsubscribe }
        : never

export type ModuleClient<TRecord extends ModuleRecord> = {
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
