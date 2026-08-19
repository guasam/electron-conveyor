import { validateSchema, type StandardSchemaV1 } from './standard-schema'
import { errorMessage } from './errors'
import type { AnyModule, BaseContext, ConveyorErrorPayload, ConveyorResult, ProcedureDef, StreamDef } from './types'

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

/**
 * Run the middleware chain around the handler (onion model): each step may guard (throw), wrap
 * (`await next()`), or extend ctx (`next({ ctx })` — merged for downstream + the handler). Returns
 * the handler result, propagated up through each middleware's return. Pure — no electron.
 */
async function runChain(
  middlewares: ProcedureDef['middlewares'],
  baseCtx: unknown,
  path: string,
  handler: (ctx: unknown) => unknown
): Promise<unknown> {
  const chain = middlewares ?? []
  let lastIndex = -1

  const advance = (index: number, ctx: unknown): Promise<unknown> => {
    if (index <= lastIndex) throw new Error(`next() called multiple times in middleware for ${path}`)
    lastIndex = index

    if (index === chain.length) return Promise.resolve(handler(ctx))

    const mw = chain[index]
    const next = (opts?: { ctx?: object }): Promise<unknown> =>
      advance(index + 1, opts?.ctx ? { ...(ctx as object), ...opts.ctx } : ctx)

    return mw({ ctx, path, type: 'procedure', next }) as Promise<unknown>
  }

  return advance(0, baseCtx)
}

/**
 * Pure procedure dispatch — no electron, no logging. Validates input (always), runs the middleware
 * chain + resolver, validates output (when `validateOutput`), and returns a typed result envelope.
 * `router.ts` wraps this with `ipcMain.handle` + a real ctx; tests call it directly.
 */
export async function dispatchProcedure(
  mod: AnyModule,
  method: string,
  input: unknown,
  ctx: BaseContext,
  validateOutput: boolean
): Promise<ConveyorResult<unknown>> {
  const def = mod.record[method]
  if (!def || def.kind !== 'procedure') {
    return { ok: false, error: { code: 'UNKNOWN_PROCEDURE', message: `Unknown procedure: ${mod.id}.${method}` } }
  }
  const proc = def as ProcedureDef
  const path = `${mod.id}.${method}`

  // Input is the trust boundary — always validated.
  const inp = await validateInput(proc.input, input, path)
  if (!inp.ok) return inp

  let result: unknown
  try {
    result = await runChain(proc.middlewares, ctx, path, (finalCtx) =>
      proc.resolver({ input: inp.value, ctx: finalCtx })
    )
  } catch (err) {
    return { ok: false, error: { code: 'HANDLER_ERROR', message: `${path}: ${errorMessage(err)}` } }
  }

  // Output is trusted (from main) — validated in dev only.
  if (validateOutput && proc.output) {
    const parsed = await validateSchema(proc.output, result)
    if (parsed.issues) {
      return {
        ok: false,
        error: { code: 'INVALID_OUTPUT', message: `Invalid output for ${path}`, issues: parsed.issues },
      }
    }
    return { ok: true, data: parsed.value }
  }
  return { ok: true, data: result }
}

export type StreamSetup =
  | { ok: true; stream: AsyncIterable<unknown>; output?: StreamDef['output'] }
  | { ok: false; error: ConveyorErrorPayload }

/**
 * Pure stream setup — validates input, runs the middleware chain, and returns the resolver's async
 * iterable (or an error envelope for setup failures). `main` pumps the iterable to the renderer and
 * validates each chunk against `output` in dev. Runtime errors surface while pumping, not here.
 */
export async function resolveStream(
  mod: AnyModule,
  method: string,
  input: unknown,
  ctx: BaseContext,
  signal: AbortSignal
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
    const stream = (await runChain(s.middlewares, ctx, path, (finalCtx) =>
      s.resolver({ input: inp.value, ctx: finalCtx, signal })
    )) as AsyncIterable<unknown>
    return { ok: true, stream, output: s.output }
  } catch (err) {
    return { ok: false, error: { code: 'HANDLER_ERROR', message: `${path}: ${errorMessage(err)}` } }
  }
}
