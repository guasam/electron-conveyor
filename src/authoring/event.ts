import type { StandardSchemaV1 } from '../core/standard-schema'
import type { EventDef } from '../core/types'

/**
 * Declare a typed main→renderer push channel. Emit from main via `createEmitter`; subscribe in the
 * renderer via the client's `.subscribe()` or the `useConveyorEvent` hook.
 */
export function event<S extends StandardSchemaV1>(payload: S): EventDef<StandardSchemaV1.InferOutput<S>> {
  return { kind: 'event', payload }
}
