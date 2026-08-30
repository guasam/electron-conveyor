import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { defineModule } from '../authoring/module'
import { query, command, stream } from '../authoring/primitives'
import { event } from '../authoring/event'
import { buildManifest } from './manifest'

describe('buildManifest', () => {
  it('maps every member of every module to its kind, keyed by router key', () => {
    const system = defineModule({
      info: query(() => 'i'),
      openUrl: command(z.string(), () => undefined),
      logs: stream(async function* () {
        yield 1
      }),
      onTick: event(z.number()),
    })
    const empty = defineModule({})

    expect(buildManifest({ system, empty })).toEqual({
      system: { info: 'query', openUrl: 'command', logs: 'stream', onTick: 'event' },
      empty: {},
    })
  })
})
