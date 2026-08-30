import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { defineModule } from '../authoring/module'
import { query, command } from '../authoring/primitives'
import { event } from '../authoring/event'
import { dispatchProcedure } from './dispatch'
import { ConveyorError } from './errors'
import type { BaseContext } from './types'

// A fake context — dispatch never touches electron, so a bare object is enough.
const ctx = { window: null, sender: {} as never, event: {} as never } as BaseContext

const mod = defineModule({
  echo: query(z.string(), ({ input }) => input.toUpperCase()),
  needsCtx: query(({ ctx }) => (ctx.window ? 'has-window' : 'no-window')),
  boom: command(() => {
    throw new Error('kaboom')
  }),
  locked: command(() => {
    throw new ConveyorError('UNAUTHORIZED', 'unlock first')
  }),
  badReturns: query({ returns: z.number() }, () => 'not-a-number' as unknown as number),
  ping: event(z.boolean()),
})
mod.id = 'demo'

describe('dispatchProcedure', () => {
  it('runs a query and returns { ok, data }', async () => {
    const res = await dispatchProcedure(mod, 'echo', 'hi', ctx, true)
    expect(res).toEqual({ ok: true, data: 'HI' })
  })

  it('passes ctx to the resolver', async () => {
    const res = await dispatchProcedure(mod, 'needsCtx', undefined, ctx, true)
    expect(res).toEqual({ ok: true, data: 'no-window' })
  })

  it('rejects invalid input with issues', async () => {
    const res = await dispatchProcedure(mod, 'echo', 123, ctx, true)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('INVALID_INPUT')
      expect(Array.isArray(res.error.issues)).toBe(true)
    }
  })

  it('captures a thrown handler error', async () => {
    const res = await dispatchProcedure(mod, 'boom', undefined, ctx, true)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('HANDLER_ERROR')
      expect(res.error.message).toContain('kaboom')
    }
  })

  it('keeps the custom code of a thrown ConveyorError', async () => {
    const res = await dispatchProcedure(mod, 'locked', undefined, ctx, true)
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error.code).toBe('UNAUTHORIZED')
      expect(res.error.message).toBe('unlock first')
    }
  })

  it('validates `returns` only when asked (dev)', async () => {
    const dev = await dispatchProcedure(mod, 'badReturns', undefined, ctx, true)
    expect(dev.ok).toBe(false)
    if (!dev.ok) expect(dev.error.code).toBe('INVALID_OUTPUT')

    // In prod (validateReturns=false) the bad value passes through untouched.
    const prod = await dispatchProcedure(mod, 'badReturns', undefined, ctx, false)
    expect(prod).toEqual({ ok: true, data: 'not-a-number' })
  })

  it('rejects unknown methods and events (not callable as procedures)', async () => {
    const unknown = await dispatchProcedure(mod, 'nope', undefined, ctx, true)
    const asEvent = await dispatchProcedure(mod, 'ping', undefined, ctx, true)
    expect(unknown.ok).toBe(false)
    expect(asEvent.ok).toBe(false)
    if (!unknown.ok) expect(unknown.error.code).toBe('UNKNOWN_PROCEDURE')
    if (!asEvent.ok) expect(asEvent.error.code).toBe('UNKNOWN_PROCEDURE')
  })

  it('runs router-global middleware before the def chain', async () => {
    const order: string[] = []
    const m = defineModule({
      go: command.use(async ({ next }) => {
        order.push('def')
        return next()
      })(() => {
        order.push('handler')
        return 'ok'
      }),
    })
    m.id = 'g'
    const res = await dispatchProcedure(m, 'go', undefined, ctx, true, [
      async ({ next }) => {
        order.push('global')
        return next()
      },
    ])
    expect(res).toEqual({ ok: true, data: 'ok' })
    expect(order).toEqual(['global', 'def', 'handler'])
  })
})
