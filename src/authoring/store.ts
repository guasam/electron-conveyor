import type { StandardSchemaV1 } from '../core/standard-schema'

/**
 * Conveyor Store — main-owned reactive state that auto-syncs across every window.
 *
 * The definition is PURE (no electron, no react) so both processes share it: main registers it as
 * the source of truth (via `createRouter`'s `stores` option); each renderer mirrors it. Actions are
 * pure reducers (mutate the draft) — side effects belong in commands, not here.
 *
 * Renderer→main action payloads cross the trust boundary, so the same rule as procedures applies:
 * **no schema, no payload**. Declare payload schemas in `schemas`; the matching action's payload
 * parameter is then typed *from its schema* — schema-first:
 *
 *   defineStore('shared', {
 *     state: { count: 0, notes: [] as string[] },
 *     schemas: { add: z.string(), increment: z.number().optional() },
 *     actions: {
 *       add: (s, note) => { s.notes.push(note) },   // note: string — inferred from the schema
 *       increment: (s, by = 1) => { s.count += by },
 *       clear: (s) => { s.notes = [] },             // no payload → no schema needed
 *     },
 *   })
 */

export type StoreSchemaMap = Record<string, StandardSchemaV1>

/** Reducers: `(state) => void`, or `(state, payload) => void` where the payload type comes from `schemas`. */
export type StoreActions<S> = Record<string, (state: S, ...args: never[]) => void>

/** The contextual actions type: schema-declared actions receive their schema's output as payload. */
export type StoreActionsFor<S, TSchemas extends StoreSchemaMap> = {
  [key: string]: (state: S, ...args: never[]) => void
} & {
  [K in keyof TSchemas]?: (state: S, payload: StandardSchemaV1.InferOutput<TSchemas[K]>) => void
}

export interface StoreDef<TId extends string, S, A extends StoreActions<S>> {
  id: TId
  initialState: S
  actions: A
  schemas?: StoreSchemaMap
  /**
   * Persist the state as JSON under the app's `userData` dir (loaded and shallow-merged over
   * `state` at registration, written debounced on change). Pass a string to name the file.
   */
  persist?: boolean | string
}

export type AnyStoreDef = StoreDef<string, any, any>

/** Client-facing action signatures: the `state` parameter is dropped (supplied in main). */
export type StoreActionsClient<S, A extends StoreActions<S>> = {
  [K in keyof A]: A[K] extends (state: S, ...args: infer P) => void ? (...args: P) => void : never
}

/** What `useConveyorStore` returns: live state merged with the bound actions. */
export type ConveyorStore<S, A extends StoreActions<S>> = S & StoreActionsClient<S, A>

export function defineStore<
  TId extends string,
  S,
  TSchemas extends StoreSchemaMap = Record<never, never>,
  A extends StoreActionsFor<S, TSchemas> = StoreActionsFor<S, TSchemas>,
>(id: TId, config: { state: S; schemas?: TSchemas; actions: A; persist?: boolean | string }): StoreDef<TId, S, A> {
  return { id, initialState: config.state, actions: config.actions, schemas: config.schemas, persist: config.persist }
}
