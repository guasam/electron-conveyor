import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { event } from './event'
import { defineModule } from './module'
import type { ConveyorClient, EventEmitters, Router } from '../core/types'
import type { ConveyorReactClient } from '../react/client'

const mod = defineModule({
  onProgress: event(z.number()),
  onNamed: event(z.object({ name: z.string() })),
})

type ProbeRouter = Router<{ probe: typeof mod }>

/**
 * Type-level assertions. Never invoked — tsc is the assertion, and an unused `@ts-expect-error` is
 * itself an error (TS2578), so a regression fails `npm run typecheck` (which prepublishOnly runs).
 *
 * `event()` captures its payload type at declaration (`event<S>(s): EventDef<InferOutput<S>>`),
 * and every consumer reads it back from there: the emitter in main, the plain client's
 * `subscribe`, and the React member's `useEvent`.
 */
function typeAssertions(
  emit: EventEmitters<typeof mod>,
  client: ConveyorClient<ProbeRouter>,
  react: ConveyorReactClient<ProbeRouter>
): void {
  // emitting from main
  emit.onProgress(1)
  emit.onNamed({ name: 'x' })

  // @ts-expect-error payload must be a number
  emit.onProgress('nope')

  // @ts-expect-error payload must be { name: string }
  emit.onNamed({ name: 123 })

  // @ts-expect-error payload is required
  emit.onProgress()

  // subscribing from the plain client
  client.probe.onProgress.subscribe((p) => {
    // @ts-expect-error the listener payload is number, not string
    const s: string = p
    void s
  })

  // the hook, which hangs off the member rather than a separate hooks object
  react.probe.onProgress.useEvent((p) => {
    const n: number = p
    void n
  })

  // @ts-expect-error the payload is number, so a string listener must not typecheck
  react.probe.onProgress.useEvent((p: string) => void p)

  react.probe.onNamed.useEvent((p) => {
    const name: string = p.name
    void name
  })
}

void typeAssertions

describe('event payload typing', () => {
  it('carries the kind on the def', () => {
    expect(mod.record.onProgress.kind).toBe('event')
    expect(mod.record.onNamed.kind).toBe('event')
  })

  it('keeps the schema for the emitter to validate against', () => {
    expect(mod.record.onProgress.payload).toBeDefined()
    expect(mod.record.onNamed.payload).toBeDefined()
  })
})
