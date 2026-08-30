import { makeCommand, makeQuery, makeStream, type ProcedureFactory, type StreamFactory } from './primitives'
import type { StandardSchemaV1 } from '../core/standard-schema'
import type { BaseContext, EventDef, Middleware, Module, ModuleRecord } from '../core/types'

/**
 * Authoring primitives returned by {@link initConveyor}, bound to an app context `TAppCtx`. Declared
 * explicitly (not inferred) so consumers re-exporting these under `declaration`/`composite` emit
 * reference named, portable types — no anonymous-class (TS4094) or un-nameable (TS2883) leaks.
 */
export interface ConveyorApi<TAppCtx extends object> {
  query: ProcedureFactory<'query', BaseContext & TAppCtx, TAppCtx>
  command: ProcedureFactory<'command', BaseContext & TAppCtx, TAppCtx>
  stream: StreamFactory<BaseContext & TAppCtx, TAppCtx>
  middleware<TAdd extends object>(mw: Middleware<BaseContext & TAppCtx, TAdd>): Middleware<BaseContext & TAppCtx, TAdd>
  event<S extends StandardSchemaV1>(payload: S): EventDef<StandardSchemaV1.InferOutput<S>>
  defineModule<TRecord extends ModuleRecord>(record: TRecord): Module<TRecord, TAppCtx>
}

/**
 * Bind the authoring primitives to the app's context shape. Modules import `query`/`command`/
 * `stream`/`event`/`defineModule` from the result, so `ctx` is `BaseContext & TAppCtx` in every
 * handler. Runtime is unchanged (still plain definition objects); `TAppCtx` is a type, so it never
 * pulls main-only runtime into the renderer. `createRouter` then requires a matching `createContext`.
 *
 * @example
 * export interface AppContext { user: User | null; db: Database }
 * export const { query, command, stream, event, middleware, defineModule } = initConveyor<AppContext>()
 */
export function initConveyor<TAppCtx extends object = object>(): ConveyorApi<TAppCtx> {
  return {
    query: makeQuery<BaseContext & TAppCtx, TAppCtx>(),
    command: makeCommand<BaseContext & TAppCtx, TAppCtx>(),
    stream: makeStream<BaseContext & TAppCtx, TAppCtx>(),
    middleware: (mw) => mw,
    event: (payload) => ({ kind: 'event', payload }),
    defineModule: (record) => ({ record }),
  }
}
