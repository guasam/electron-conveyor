import { validateSchema } from '../core/standard-schema'
import { resolveTargets, type EmitTarget } from './window-manager'
import type { AnyModule, EventEmitters } from '../core/types'
import { isDev } from './env'

/**
 * Build the typed push emitters for a module against a target — a single window, or a resolver for
 * many (`manager.broadcast` / `manager.to(label)` / `manager.except(sender)`). Wire main-side
 * sources to these, e.g. `win.on('focus', () => emit.onFocusChange(true))`.
 */
export function createEmitter<TModule extends AnyModule>(mod: TModule, target: EmitTarget): EventEmitters<TModule> {
  const emitters: Record<string, (payload: unknown) => void> = {}

  for (const key of Object.keys(mod.record)) {
    const def = mod.record[key]
    if (def.kind !== 'event') continue
    const channel = `conveyor:event:${mod.id}:${key}`

    emitters[key] = (payload: unknown) => {
      // Dev-only correctness check; non-blocking so emit stays fire-and-forget.
      if (isDev) {
        void Promise.resolve(validateSchema(def.payload, payload)).then((r) => {
          if (r.issues) console.error(`[conveyor] invalid event payload for ${mod.id}.${key}`, r.issues)
        })
      }
      for (const win of resolveTargets(target)) win.webContents.send(channel, payload)
    }
  }

  return emitters as EventEmitters<TModule>
}
