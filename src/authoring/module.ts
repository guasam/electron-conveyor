import type { Module, ModuleRecord } from '../core/types'

/**
 * Group procedures and events under a namespace id — the single source of truth for a feature.
 * The renderer client type is inferred from it; no hand-written API classes, no channel strings.
 * (For a typed ctx, use `initConveyor<AppContext>().defineModule`.)
 */
export function defineModule<TId extends string, TRecord extends ModuleRecord>(
  id: TId,
  record: TRecord
): Module<TId, TRecord> {
  return { id, record }
}
