import { validateSchema } from './standard-schema'
import type { AnyModule, BaseContext, ConveyorResult, ProcedureDef } from './types'

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

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
  let parsedInput: unknown = input
  if (proc.input) {
    const parsed = await validateSchema(proc.input, input)
    if (parsed.issues) {
      return { ok: false, error: { code: 'INVALID_INPUT', message: `Invalid input for ${path}`, issues: parsed.issues } }
    }
    parsedInput = parsed.value
  }

  let result: unknown
  try {
    result = await runChain(proc.middlewares, ctx, path, (finalCtx) =>
      proc.resolver({ input: parsedInput, ctx: finalCtx })
    )
  } catch (err) {
    return { ok: false, error: { code: 'HANDLER_ERROR', message: `${path}: ${message(err)}` } }
  }

  // Output is trusted (from main) — validated in dev only.
  if (validateOutput && proc.output) {
    const parsed = await validateSchema(proc.output, result)
    if (parsed.issues) {
      return { ok: false, error: { code: 'INVALID_OUTPUT', message: `Invalid output for ${path}`, issues: parsed.issues } }
    }
    return { ok: true, data: parsed.value }
  }
  return { ok: true, data: result }
}
