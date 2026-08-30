import { validateSchema, type StandardSchemaV1 } from './standard-schema'
import { ConveyorError, errorMessage } from './errors'
import type {
  AnyMiddleware,
  AnyModule,
  BaseContext,
  ConveyorErrorPayload,
  ConveyorResult,
  ProcedureDef,
  StreamDef,
} from './types'

/** Validate a call's single input against its schema (the trust boundary). Shared by both paths. */
async function validateInput(
  schema: StandardSchemaV1 | undefined,
  input: unknown,
  path: string
): Promise<{ ok: true; value: unknown } | { ok: false; error: ConveyorErrorPayload }> {
  if (!schema) return { ok: true, value: input }
  const parsed = await validateSchema(schema, input)
  if (parsed.issues) {
    return { ok: false, error: { code: 'INVALID_INPUT', message: `Invalid input for ${path}`, issues: parsed.issues } }
  }
  return { ok: true, value: parsed.value }
}

/** A thrown ConveyorError keeps its custom code across the boundary; anything else is HANDLER_ERROR. */
function toErrorPayload(err: unknown, path: string): ConveyorErrorPayload {
  if (err instanceof ConveyorError) return { code: err.code, message: err.message, issues: err.issues }
  return { code: 'HANDLER_ERROR', message: `${path}: ${errorMessage(err)}` }
}

/**
 * Run the middleware chain around the handler (onion model): each step may guard (throw), wrap
 * (`await next()`), or extend ctx (`next({ ctx })` — merged for downstream + the handler). Returns
 * the handler result, propagated up through each middleware's return. Pure — no electron.
 */
async function runChain(
  middlewares: readonly AnyMiddleware[],
  type: 'query' | 'command' | 'stream',
  baseCtx: unknown,
  path: string,
  handler: (ctx: unknown) => unknown
): Promise<unknown> {
  let lastIndex = -1

  const advance = (index: number, ctx: unknown): Promise<unknown> => {
    if (index <= lastIndex) throw new Error(`next() called multiple times in middleware for ${path}`)
    lastIndex = index

    if (index === middlewares.length) return Promise.resolve(handler(ctx))

    const mw = middlewares[index]
    const next = (opts?: { ctx?: object }): Promise<unknown> =>
      advance(index + 1, opts?.ctx ? { ...(ctx as object), ...opts.ctx } : ctx)

    return mw({ ctx, path, type, next }) as Promise<unknown>
  }

  return advance(0, baseCtx)
}

/**
 * Pure procedure dispatch — no electron, no logging. Validates input (always), runs the middleware
 * chain (router-global first, then the def's own) + resolver, validates `returns` in dev, and
 * returns a typed result envelope. `router.ts` wraps this with `ipcMain.handle` + a real ctx;
 * `createCaller` and tests call it directly.
 */
export async function dispatchProcedure(
  mod: AnyModule,
  method: string,
  input: unknown,
  ctx: BaseContext,
  validateReturns: boolean,
  globalMiddlewares: readonly AnyMiddleware[] = []
): Promise<ConveyorResult<unknown>> {
  const def = mod.record[method]
  if (!def || (def.kind !== 'query' && def.kind !== 'command')) {
    return { ok: false, error: { code: 'UNKNOWN_PROCEDURE', message: `Unknown procedure: ${mod.id}.${method}` } }
  }
  const proc = def as ProcedureDef
  const path = `${mod.id}.${method}`

  // Input is the trust boundary — always validated.
  const inp = await validateInput(proc.input, input, path)
  if (!inp.ok) return inp

  let result: unknown
  try {
    result = await runChain([...globalMiddlewares, ...(proc.middlewares ?? [])], proc.kind, ctx, path, (finalCtx) =>
      proc.resolver({ input: inp.value, ctx: finalCtx })
    )
  } catch (err) {
    return { ok: false, error: toErrorPayload(err, path) }
  }

  // The result comes from trusted main code — validated in dev only.
  if (validateReturns && proc.returns) {
    const parsed = await validateSchema(proc.returns, result)
    if (parsed.issues) {
      return {
        ok: false,
        error: { code: 'INVALID_OUTPUT', message: `Invalid result for ${path}`, issues: parsed.issues },
      }
    }
    return { ok: true, data: parsed.value }
  }
  return { ok: true, data: result }
}

export type StreamSetup =
  | { ok: true; stream: AsyncIterable<unknown>; returns?: StreamDef['returns'] }
  | { ok: false; error: ConveyorErrorPayload }

/**
 * Pure stream setup — validates input, runs the middleware chain, and returns the resolver's async
 * iterable (or an error envelope for setup failures). `main` pumps the iterable to the renderer and
 * validates each chunk against `returns` in dev. Runtime errors surface while pumping, not here.
 */
export async function resolveStream(
  mod: AnyModule,
  method: string,
  input: unknown,
  ctx: BaseContext,
  signal: AbortSignal,
  globalMiddlewares: readonly AnyMiddleware[] = []
): Promise<StreamSetup> {
  const def = mod.record[method]
  if (!def || def.kind !== 'stream') {
    return { ok: false, error: { code: 'UNKNOWN_PROCEDURE', message: `Unknown stream: ${mod.id}.${method}` } }
  }
  const s = def as StreamDef
  const path = `${mod.id}.${method}`

  const inp = await validateInput(s.input, input, path)
  if (!inp.ok) return inp

  try {
    const stream = (await runChain([...globalMiddlewares, ...(s.middlewares ?? [])], 'stream', ctx, path, (finalCtx) =>
      s.resolver({ input: inp.value, ctx: finalCtx, signal })
    )) as AsyncIterable<unknown>
    return { ok: true, stream, returns: s.returns }
  } catch (err) {
    return { ok: false, error: toErrorPayload(err, path) }
  }
}
