import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { initConveyor } from '../authoring/init'
import { dispatchProcedure } from './dispatch'
import type { BaseContext } from './types'

const base = { window: null, sender: {} as never, event: {} as never } as BaseContext

interface AppContext {
  user: { id: string } | null
}
const t = initConveyor<AppContext>()

describe('middleware + context', () => {
  it('runs middleware in order and reaches the handler', async () => {
    const order: string[] = []
    const mod = t.defineModule('m', {
      go: t
        .procedure()
        .use(async ({ next }) => {
          order.push('a:before')
          const r = await next()
          order.push('a:after')
          return r
        })
        .use(async ({ next }) => {
          order.push('b:before')
          const r = await next()
          order.push('b:after')
          return r
        })
        .handle(() => {
          order.push('handler')
          return 'ok'
        }),
    })

    const res = await dispatchProcedure(mod, 'go', undefined, base, true)
    expect(res).toEqual({ ok: true, data: 'ok' })
    expect(order).toEqual(['a:before', 'b:before', 'handler', 'b:after', 'a:after'])
  })

  it('merges ctx extensions from next({ ctx }) into the handler ctx', async () => {
    const mod = t.defineModule('m', {
      whoami: t
        .procedure()
        .use(({ next }) => next({ ctx: { user: { id: 'u1' } } }))
        .handle(({ ctx }) => ctx.user?.id ?? 'anon'),
    })

    const res = await dispatchProcedure(mod, 'whoami', undefined, base, true)
    expect(res).toEqual({ ok: true, data: 'u1' })
  })

  it('surfaces the app context supplied by main (merged before dispatch)', async () => {
    const mod = t.defineModule('m', {
      whoami: t.procedure().handle(({ ctx }) => ctx.user?.id ?? 'anon'),
    })
    const withUser = { ...base, user: { id: 'ctx-user' } } as BaseContext
    const res = await dispatchProcedure(mod, 'whoami', undefined, withUser, true)
    expect(res).toEqual({ ok: true, data: 'ctx-user' })
  })

  it('a guard middleware that throws becomes HANDLER_ERROR and skips the handler', async () => {
    let ran = false
    const mod = t.defineModule('m', {
      secret: t
        .procedure()
        .use(({ ctx, next }) => {
          if (!ctx.user) throw new Error('unauthenticated')
          return next()
        })
        .handle(() => {
          ran = true
          return 'secret'
        }),
    })

    const res = await dispatchProcedure(mod, 'secret', undefined, base, true)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.message).toContain('unauthenticated')
    expect(ran).toBe(false)
  })

  it('still validates input before any middleware runs', async () => {
    let ran = false
    const mod = t.defineModule('m', {
      echo: t
        .procedure()
        .input(z.string())
        .use(({ next }) => {
          ran = true
          return next()
        })
        .handle(({ input }) => input),
    })

    const res = await dispatchProcedure(mod, 'echo', 123, base, true)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.code).toBe('INVALID_INPUT')
    expect(ran).toBe(false)
  })
})
