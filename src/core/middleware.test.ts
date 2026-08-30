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

const named = <M extends { id?: string }>(mod: M): M => ((mod.id = 'm'), mod)

describe('middleware bases + context', () => {
  it('derived bases run their middleware in order and reach the handler', async () => {
    const order: string[] = []
    const a = t.command.use(async ({ next }) => {
      order.push('a:before')
      const r = await next()
      order.push('a:after')
      return r
    })
    const ab = a.use(async ({ next }) => {
      order.push('b:before')
      const r = await next()
      order.push('b:after')
      return r
    })
    const mod = named(
      t.defineModule({
        go: ab(() => {
          order.push('handler')
          return 'ok'
        }),
      })
    )

    const res = await dispatchProcedure(mod, 'go', undefined, base, true)
    expect(res).toEqual({ ok: true, data: 'ok' })
    expect(order).toEqual(['a:before', 'b:before', 'handler', 'b:after', 'a:after'])
  })

  it('a base is reusable — deriving does not mutate the parent', async () => {
    let count = 0
    const counted = t.query.use(({ next }) => {
      count++
      return next()
    })
    const mod = named(
      t.defineModule({
        plain: t.query(() => 'plain'), // the root base stays middleware-free
        counted: counted(() => 'counted'),
      })
    )

    await dispatchProcedure(mod, 'plain', undefined, base, true)
    expect(count).toBe(0)
    await dispatchProcedure(mod, 'counted', undefined, base, true)
    expect(count).toBe(1)
  })

  it('merges ctx extensions from next({ ctx }) into the handler ctx', async () => {
    const withTag = t.query.use(({ next }) => next({ ctx: { tag: 'mw' } }))
    const mod = named(
      t.defineModule({
        whoami: withTag(({ ctx }) => `${ctx.user?.id ?? 'anon'}:${ctx.tag}`),
      })
    )

    const res = await dispatchProcedure(mod, 'whoami', undefined, { ...base, user: null } as BaseContext, true)
    expect(res).toEqual({ ok: true, data: 'anon:mw' })
  })

  it('surfaces the app context supplied by main (merged before dispatch)', async () => {
    const mod = named(
      t.defineModule({
        whoami: t.query(({ ctx }) => ctx.user?.id ?? 'anon'),
      })
    )
    const withUser = { ...base, user: { id: 'ctx-user' } } as BaseContext
    const res = await dispatchProcedure(mod, 'whoami', undefined, withUser, true)
    expect(res).toEqual({ ok: true, data: 'ctx-user' })
  })

  it('a guard middleware that throws becomes HANDLER_ERROR and skips the handler', async () => {
    let ran = false
    const authed = t.command.use(({ ctx, next }) => {
      if (!ctx.user) throw new Error('unauthenticated')
      return next()
    })
    const mod = named(
      t.defineModule({
        secret: authed(() => {
          ran = true
          return 'secret'
        }),
      })
    )

    const res = await dispatchProcedure(mod, 'secret', undefined, { ...base, user: null } as BaseContext, true)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.message).toContain('unauthenticated')
    expect(ran).toBe(false)
  })

  it('still validates input before any middleware runs', async () => {
    let ran = false
    const traced = t.command.use(({ next }) => {
      ran = true
      return next()
    })
    const mod = named(
      t.defineModule({
        echo: traced(z.string(), ({ input }) => input),
      })
    )

    const res = await dispatchProcedure(mod, 'echo', 123, base, true)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.code).toBe('INVALID_INPUT')
    expect(ran).toBe(false)
  })

  it('the middleware() helper types a reusable step (runtime passthrough)', async () => {
    const tag = t.middleware(({ next }) => next({ ctx: { tag: 'shared' } }))
    const mod = named(
      t.defineModule({
        read: t.query.use(tag)(({ ctx }) => ctx.tag),
      })
    )
    const res = await dispatchProcedure(mod, 'read', undefined, { ...base, user: null } as BaseContext, true)
    expect(res).toEqual({ ok: true, data: 'shared' })
  })
})
