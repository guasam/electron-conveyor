import type { Module, ModuleRecord } from '../core/types'

/**
 * Group queries, commands, streams, and events into a module — the single source of truth for a
 * feature. The renderer client type is inferred from it; no hand-written API classes, no channel
 * strings. The module's id comes from its key in `createRouter({ ... })` — declared once, there.
 * (For a typed ctx, use `initConveyor<AppContext>().defineModule`.)
 */
export function defineModule<TRecord extends ModuleRecord>(record: TRecord): Module<TRecord> {
  return { record }
}
