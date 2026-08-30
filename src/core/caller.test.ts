import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { initConveyor } from '../authoring/init'
import { createCaller } from './caller'
import { ConveyorError } from './errors'
import type { Router } from './types'

interface AppContext {
  appStartedAt: number
}
const t = initConveyor<AppContext>()

const demo = t.defineModule({
  echo: t.query(z.string(), ({ input }) => input.toUpperCase()),
  uptime: t.query(({ ctx }) => Date.now() - ctx.appStartedAt),
  locked: t.command(() => {
    throw new ConveyorError('UNAUTHORIZED', 'unlock first')
  }),
  count: t.stream(z.number(), async function* ({ input }) {
    for (let i = 1; i <= input; i++) yield i
  }),
  onTick: t.event(z.number()),
})

// A plain router value — createCaller needs no electron and no createRouter.
const router: Router<{ demo: typeof demo }> = { modules: { demo } }
const caller = createCaller(router, { ctx: { appStartedAt: Date.now() - 1000 } })

describe('createCaller', () => {
  it('calls procedures in-process with validation and the supplied ctx', async () => {
    expect(await caller.demo.echo('hi')).toBe('HI')
    expect(await caller.demo.uptime()).toBeGreaterThanOrEqual(1000)
  })

  it('throws ConveyorError (not an envelope) on failure', async () => {
    await expect(caller.demo.echo(123 as never)).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    await expect(caller.demo.locked()).rejects.toMatchObject({ code: 'UNAUTHORIZED', message: 'unlock first' })
  })

  it('resolves streams to their AsyncIterable', async () => {
    const seen: number[] = []
    for await (const n of await caller.demo.count(3)) seen.push(n)
    expect(seen).toEqual([1, 2, 3])
  })

  it('refuses events and unknown modules', async () => {
    await expect((caller.demo as never as Record<string, () => Promise<unknown>>).onTick()).rejects.toMatchObject({
      code: 'HANDLER_ERROR',
    })
    expect(() => (caller as never as Record<string, unknown>).nope).toThrowError(/Unknown module/)
  })
})
