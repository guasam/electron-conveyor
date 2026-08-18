import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { initConveyor } from '../authoring/init'
import { resolveStream } from './dispatch'
import type { BaseContext } from './types'

const base = { window: null, sender: {} as never, event: {} as never } as BaseContext
const t = initConveyor()

async function collect(stream: AsyncIterable<unknown>): Promise<unknown[]> {
  const out: unknown[] = []
  for await (const chunk of stream) out.push(chunk)
  return out
}

describe('resolveStream', () => {
  it('yields the generator chunks in order', async () => {
    const mod = t.defineModule('m', {
      count: t
        .procedure()
        .input(z.number())
        .stream(async function* ({ input }) {
          for (let i = 1; i <= input; i++) yield i
        }),
    })

    const setup = await resolveStream(mod, 'count', 3, base, new AbortController().signal)
    expect(setup.ok).toBe(true)
    if (setup.ok) expect(await collect(setup.stream)).toEqual([1, 2, 3])
  })

  it('validates input before starting the stream', async () => {
    const mod = t.defineModule('m', {
      count: t
        .procedure()
        .input(z.number())
        .stream(async function* () {
          yield 1
        }),
    })

    const setup = await resolveStream(mod, 'count', 'nope', base, new AbortController().signal)
    expect(setup.ok).toBe(false)
    if (!setup.ok) expect(setup.error.code).toBe('INVALID_INPUT')
  })

  it('rejects an unknown or non-stream method', async () => {
    const mod = t.defineModule('m', {
      notAStream: t.procedure().handle(() => 'x'),
    })
    const unknown = await resolveStream(mod, 'nope', undefined, base, new AbortController().signal)
    const wrongKind = await resolveStream(mod, 'notAStream', undefined, base, new AbortController().signal)
    expect(unknown.ok).toBe(false)
    expect(wrongKind.ok).toBe(false)
  })

  it('runs middleware (ctx-extension reaches the generator) and exposes the abort signal', async () => {
    const mod = t.defineModule('m', {
      tick: t
        .procedure()
        .use(({ next }) => next({ ctx: { tag: 'mw' } }))
        .stream(async function* ({ ctx, signal }) {
          yield (ctx as { tag: string }).tag
          yield signal.aborted
        }),
    })

    const setup = await resolveStream(mod, 'tick', undefined, base, new AbortController().signal)
    expect(setup.ok).toBe(true)
    if (setup.ok) expect(await collect(setup.stream)).toEqual(['mw', false])
  })

  it('stops early when the consumer breaks (generator observes it via return)', async () => {
    let cleanedUp = false
    const mod = t.defineModule('m', {
      forever: t.procedure().stream(async function* () {
        try {
          let i = 0
          while (true) yield i++
        } finally {
          cleanedUp = true
        }
      }),
    })

    const setup = await resolveStream(mod, 'forever', undefined, base, new AbortController().signal)
    expect(setup.ok).toBe(true)
    if (setup.ok) {
      const seen: unknown[] = []
      for await (const chunk of setup.stream) {
        seen.push(chunk)
        if (seen.length === 3) break
      }
      expect(seen).toEqual([0, 1, 2])
      expect(cleanedUp).toBe(true)
    }
  })
})
