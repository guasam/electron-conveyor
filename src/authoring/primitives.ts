import type { StandardSchemaV1 } from '../core/standard-schema'
import type { AnyMiddleware, BaseContext, Middleware, ProcedureDef, ProcedureKind, StreamDef } from '../core/types'

/*
 * The authoring primitives: `query` (read), `command` (act), `stream` (async-generator push).
 * Each is a callable factory — the common cases read like function definitions:
 *
 *   stats:   query(({ ctx }) => getStats())                         // no input → no schema needed
 *   openUrl: command(z.url(), ({ input }) => shell.openExternal(input))
 *   logs:    stream(z.string(), async function* ({ input, signal }) { ... })
 *
 * The rule is "no schema, no input": accepting an input requires declaring its schema, because
 * renderer input is the trust boundary. The rare full form takes an options object
 * (`query({ input, returns }, handler)`) — `returns` is a dev-only result check.
 *
 * Middleware attaches to *bases*, not per-call chains: `const authed = command.use(requireAuth)`
 * derives a reusable factory whose ctx is widened by everything the middleware adds.
 */

interface DefOptions<S extends StandardSchemaV1 | undefined> {
  input?: S
  /** Dev-only result validation (per-chunk for streams). Not a security boundary. */
  returns?: StandardSchemaV1
}

type InputOf<S> = S extends StandardSchemaV1 ? StandardSchemaV1.InferOutput<S> : void

export interface ProcedureFactory<TKind extends ProcedureKind, TCtx, TAppCtx extends object> {
  /** No input: `query(({ ctx }) => ...)` */
  <TResult>(handler: (opts: { ctx: TCtx }) => TResult): ProcedureDef<TKind, void, TResult, TAppCtx>
  /** Validated input: `query(schema, ({ input, ctx }) => ...)` */
  <S extends StandardSchemaV1, TResult>(
    input: S,
    handler: (opts: { input: StandardSchemaV1.InferOutput<S>; ctx: TCtx }) => TResult
  ): ProcedureDef<TKind, StandardSchemaV1.InferOutput<S>, TResult, TAppCtx>
  /** Full form: `query({ input?, returns? }, handler)` */
  <S extends StandardSchemaV1 | undefined, TResult>(
    opts: DefOptions<S>,
    handler: (opts: { input: InputOf<S>; ctx: TCtx }) => TResult
  ): ProcedureDef<TKind, InputOf<S>, TResult, TAppCtx>
  /** Derive a new factory with a middleware step (guard, wrap, or widen ctx via `next({ ctx })`). */
  use<TAdd extends object>(mw: Middleware<TCtx, TAdd>): ProcedureFactory<TKind, TCtx & TAdd, TAppCtx>
}

export interface StreamFactory<TCtx, TAppCtx extends object> {
  /** No input: `stream(async function* ({ ctx, signal }) { ... })` */
  <TChunk>(
    handler: (opts: { ctx: TCtx; signal: AbortSignal }) => AsyncIterable<TChunk>
  ): StreamDef<void, TChunk, TAppCtx>
  /** Validated input: `stream(schema, async function* ({ input, ctx, signal }) { ... })` */
  <S extends StandardSchemaV1, TChunk>(
    input: S,
    handler: (opts: { input: StandardSchemaV1.InferOutput<S>; ctx: TCtx; signal: AbortSignal }) => AsyncIterable<TChunk>
  ): StreamDef<StandardSchemaV1.InferOutput<S>, TChunk, TAppCtx>
  /** Full form: `stream({ input?, returns? }, handler)` — `returns` validates each chunk in dev. */
  <S extends StandardSchemaV1 | undefined, TChunk>(
    opts: DefOptions<S>,
    handler: (opts: { input: InputOf<S>; ctx: TCtx; signal: AbortSignal }) => AsyncIterable<TChunk>
  ): StreamDef<InputOf<S>, TChunk, TAppCtx>
  use<TAdd extends object>(mw: Middleware<TCtx, TAdd>): StreamFactory<TCtx & TAdd, TAppCtx>
}

function isSchema(value: unknown): value is StandardSchemaV1 {
  return !!value && (typeof value === 'object' || typeof value === 'function') && '~standard' in value
}

function normalize(a: unknown, b: unknown) {
  if (typeof a === 'function') return { input: undefined, returns: undefined, resolver: a }
  if (isSchema(a)) return { input: a, returns: undefined, resolver: b as (opts: never) => unknown }
  const opts = a as DefOptions<StandardSchemaV1 | undefined>
  return { input: opts.input, returns: opts.returns, resolver: b as (opts: never) => unknown }
}

/** Runtime factory shared by all three kinds; the exported types constrain what each produces. */
function makeFactory(kind: ProcedureKind | 'stream', middlewares: AnyMiddleware[]): unknown {
  const create = (a: unknown, b?: unknown) => {
    const { input, returns, resolver } = normalize(a, b)
    return { kind, input, returns, middlewares, resolver }
  }
  create.use = (mw: AnyMiddleware) => makeFactory(kind, [...middlewares, mw])
  return create
}

export function makeQuery<TCtx, TAppCtx extends object>(): ProcedureFactory<'query', TCtx, TAppCtx> {
  return makeFactory('query', []) as ProcedureFactory<'query', TCtx, TAppCtx>
}

export function makeCommand<TCtx, TAppCtx extends object>(): ProcedureFactory<'command', TCtx, TAppCtx> {
  return makeFactory('command', []) as ProcedureFactory<'command', TCtx, TAppCtx>
}

export function makeStream<TCtx, TAppCtx extends object>(): StreamFactory<TCtx, TAppCtx> {
  return makeFactory('stream', []) as StreamFactory<TCtx, TAppCtx>
}

/** Zero-context factories, for apps that don't need a custom `AppContext`. */
export const query: ProcedureFactory<'query', BaseContext, object> = makeQuery()
export const command: ProcedureFactory<'command', BaseContext, object> = makeCommand()
export const stream: StreamFactory<BaseContext, object> = makeStream()
