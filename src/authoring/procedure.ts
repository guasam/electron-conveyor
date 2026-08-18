import type { StandardSchemaV1 } from '../core/standard-schema'
import type { AnyMiddleware, BaseContext, Middleware, ProcedureDef } from '../core/types'

/**
 * Fluent builder for a renderer→main procedure. `TInput` flows from `.input()`; `TCtx` is the
 * accumulated handler context (`BaseContext & TAppCtx`, widened by each `.use()`); `TAppCtx` is what
 * `createContext` must supply, threaded onto the def so `createRouter` can demand it.
 *
 * Immutable (every step returns a new builder). Uses native `#private` fields, not TS `private`, so
 * the class stays portable in consumers' declaration emit (avoids TS4094).
 */
export class ProcedureBuilder<TInput = void, TCtx = BaseContext, TAppCtx extends object = object> {
  readonly #input?: StandardSchemaV1
  readonly #output?: StandardSchemaV1
  readonly #middlewares: AnyMiddleware[]

  constructor(input?: StandardSchemaV1, output?: StandardSchemaV1, middlewares: AnyMiddleware[] = []) {
    this.#input = input
    this.#output = output
    this.#middlewares = middlewares
  }

  /** Declare & validate the single input argument (validated on every call — the trust boundary). */
  input<S extends StandardSchemaV1>(schema: S): ProcedureBuilder<StandardSchemaV1.InferOutput<S>, TCtx, TAppCtx> {
    return new ProcedureBuilder(schema, this.#output, this.#middlewares)
  }

  /** Declare the output schema. Validated in dev only; does not change the inferred result type. */
  output<S extends StandardSchemaV1>(schema: S): ProcedureBuilder<TInput, TCtx, TAppCtx> {
    return new ProcedureBuilder(this.#input, schema, this.#middlewares)
  }

  /** Add a middleware step: may guard, wrap (`await next()`), or `next({ ctx })` to widen `TCtx`. */
  use<TAdd extends object>(mw: Middleware<TCtx, TAdd>): ProcedureBuilder<TInput, TCtx & TAdd, TAppCtx> {
    return new ProcedureBuilder(this.#input, this.#output, [...this.#middlewares, mw as unknown as AnyMiddleware])
  }

  /** Attach the implementation. Its return type becomes the client's awaited result type. */
  handle<TResult>(resolver: (opts: { input: TInput; ctx: TCtx }) => TResult): ProcedureDef<TInput, TResult, TAppCtx> {
    return {
      kind: 'procedure',
      input: this.#input,
      output: this.#output,
      middlewares: this.#middlewares,
      resolver: resolver as ProcedureDef<TInput, TResult, TAppCtx>['resolver'],
    }
  }
}

/** Zero-context procedure builder. For a typed ctx, use `initConveyor<AppContext>().procedure`. */
export function procedure(): ProcedureBuilder {
  return new ProcedureBuilder()
}
