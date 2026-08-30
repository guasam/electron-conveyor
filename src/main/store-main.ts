import { app, BrowserWindow, ipcMain } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { channels, STORE_GET } from '../core/channels'
import { ConveyorError } from '../core/errors'
import { validateSchema, type StandardSchemaV1 } from '../core/standard-schema'
import type { AnyStoreDef, StoreActions, StoreDef } from '../authoring/store'

type DropFirst<T extends unknown[]> = T extends [unknown, ...infer R] ? R : never

export interface StoreHandle<S, A extends StoreActions<S>> {
  getState: () => S
  /** Run an action from main (trusted — no payload validation) and broadcast the change. */
  dispatch: <K extends keyof A>(action: K, ...args: DropFirst<Parameters<A[K]>>) => void
  /** Observe every change from main. Returns an unsubscribe. */
  subscribe: (listener: (state: S) => void) => () => void
}

/**
 * Register a store on main as the single source of truth: holds state, runs actions, broadcasts
 * every change to all windows, and (with `persist`) round-trips the state to a JSON file under
 * `userData`. Renderer-invoked action payloads are validated against `schemas` — an action that
 * takes a payload but has no schema is a registration error, not a silent trust hole.
 *
 * Registered via `createRouter`'s `stores` option; exported for advanced standalone use.
 */
export function registerStore<TId extends string, S, A extends StoreActions<S>>(
  def: StoreDef<TId, S, A>
): StoreHandle<S, A> {
  const channel = channels.store(def.id)
  const changed = channels.storeChanged(def.id)
  const actions = def.actions as unknown as Record<string, (state: S, payload?: unknown) => void>
  const schemas = (def.schemas ?? {}) as Record<string, StandardSchemaV1 | undefined>

  if (STORE_GET in actions) {
    throw new Error(`[conveyor] store '${def.id}': '${STORE_GET}' is a reserved action name`)
  }
  for (const name of Object.keys(actions)) {
    // fn.length ignores defaulted params, so `(s, by = 1)` passes — its payload is still schema-gated
    // at call time below. This catches the plainly-declared `(s, payload)` case at startup.
    if (actions[name].length >= 2 && !schemas[name]) {
      throw new Error(
        `[conveyor] store '${def.id}': action '${name}' takes a payload but has no schema — ` +
          `renderer payloads cross the trust boundary, add one under 'schemas.${name}'`
      )
    }
  }

  let state = structuredClone(def.initialState) as S
  const persistence = def.persist ? setupPersistence(def, () => state) : undefined
  if (persistence?.loaded !== undefined) state = persistence.loaded as S

  const listeners = new Set<(s: S) => void>()

  const broadcast = () => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(changed, state)
    }
    for (const listener of listeners) listener(state)
    persistence?.schedule()
  }

  /** Renderer-invoked path — payloads are untrusted and validated. */
  const runValidated = async (name: string, payload: unknown) => {
    const action = actions[name]
    if (!action) throw new ConveyorError('UNKNOWN_PROCEDURE', `Unknown store action: ${def.id}.${name}`)

    const schema = schemas[name]
    if (schema) {
      const parsed = await validateSchema(schema, payload)
      if (parsed.issues) {
        throw new ConveyorError('INVALID_INPUT', `Invalid payload for store action ${def.id}.${name}`, parsed.issues)
      }
      action(state, parsed.value)
    } else {
      if (payload !== undefined) {
        throw new ConveyorError(
          'INVALID_INPUT',
          `Store action ${def.id}.${name} takes no payload (declare a schema to accept one)`
        )
      }
      action(state)
    }
    broadcast()
  }

  ipcMain.removeHandler(channel) // HMR-safe
  ipcMain.handle(channel, async (_event, method: string, wire?: { payload?: unknown }) => {
    if (method === STORE_GET) return state
    await runValidated(method, wire?.payload)
    return state
  })

  return {
    getState: () => state,
    dispatch: (name, ...args) => {
      const action = actions[name as string] as ((s: S, ...rest: unknown[]) => void) | undefined
      if (!action) throw new Error(`[conveyor] Unknown store action: ${def.id}.${String(name)}`)
      action(state, ...args)
      broadcast()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/**
 * JSON persistence under `userData/conveyor-stores/<id>.json` (or a custom filename when `persist`
 * is a string). Load happens once at registration (shallow-merged over the initial state, so new
 * fields added in code survive old files); writes are debounced and flushed on quit.
 */
function setupPersistence(def: AnyStoreDef, getState: () => unknown) {
  const name = typeof def.persist === 'string' ? def.persist : `${def.id}.json`
  const file = join(app.getPath('userData'), 'conveyor-stores', name)

  let loaded: unknown
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    const initial = structuredClone(def.initialState)
    loaded =
      saved && typeof saved === 'object' && initial && typeof initial === 'object'
        ? { ...(initial as object), ...(saved as object) }
        : saved
  } catch {
    // No file yet, or unreadable/corrupt — start from the initial state.
  }

  let timer: NodeJS.Timeout | undefined
  const write = () => {
    timer = undefined
    try {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, JSON.stringify(getState(), null, 2))
    } catch (err) {
      console.error(`[conveyor] failed to persist store '${def.id}' to ${file}`, err)
    }
  }
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(write, 200)
  }
  app.on('before-quit', () => {
    if (timer) {
      clearTimeout(timer)
      write()
    }
  })

  return { loaded, schedule }
}
