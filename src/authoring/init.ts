import { ProcedureBuilder } from './procedure'
import type { StandardSchemaV1 } from '../core/standard-schema'
import type { BaseContext, EventDef, Middleware, Module, ModuleRecord } from '../core/types'

/**
 * Authoring primitives returned by {@link initConveyor}, bound to an app context `TAppCtx`. Declared
 * explicitly (not inferred) so consumers re-exporting these under `declaration`/`composite` emit
 * reference named, portable types — no anonymous-class (TS4094) or un-nameable (TS2883) leaks.
 */
export interface ConveyorApi<TAppCtx extends object> {
  procedure(): ProcedureBuilder<void, BaseContext & TAppCtx, TAppCtx>
  middleware<TAdd extends object>(mw: Middleware<BaseContext & TAppCtx, TAdd>): Middleware<BaseContext & TAppCtx, TAdd>
  event<S extends StandardSchemaV1>(payload: S): EventDef<StandardSchemaV1.InferOutput<S>>
  defineModule<TId extends string, TRecord extends ModuleRecord>(
    id: TId,
    record: TRecord
  ): Module<TId, TRecord, TAppCtx>
}

/**
 * Bind the authoring primitives to the app's context shape. Modules import `procedure`/`defineModule`/
 * `event` from the result, so `ctx` is `BaseContext & TAppCtx` in every handler. Runtime is unchanged
 * (still plain definition objects); `TAppCtx` is a type, so it never pulls main-only runtime into the
 * renderer. `createRouter` then requires a `createContext` producing `TAppCtx`.
 *
 * @example
 * export interface AppContext { user: User | null; db: Database }
 * export const { procedure, defineModule, event, middleware } = initConveyor<AppContext>()
 */
export function initConveyor<TAppCtx extends object = object>(): ConveyorApi<TAppCtx> {
  return {
    procedure: () => new ProcedureBuilder<void, BaseContext & TAppCtx, TAppCtx>(),
    middleware: (mw) => mw,
    event: (payload) => ({ kind: 'event', payload }),
    defineModule: (id, record) => ({ id, record }),
  }
}
