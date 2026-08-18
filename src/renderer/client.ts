import { ConveyorError } from '../core/errors'
import type { ConveyorClient, ConveyorResult, Router, Unsubscribe } from '../core/types'

/** The minimal, Zod-free surface the preload exposes across the context bridge. */
export interface ConveyorBridge {
  invoke: (channel: string, method: string, ...args: unknown[]) => Promise<unknown>
  subscribe: (channel: string, cb: (payload: unknown) => void) => Unsubscribe
}

declare global {
  interface Window {
    conveyor: ConveyorBridge
  }
}

/**
 * Build the typed renderer client — a Proxy over `window.conveyor` carrying no runtime method
 * metadata, so the router (Zod + handlers) stays 100% in main. Each member is a callable that also
 * has `.subscribe`; the inferred type exposes only the correct shape per member.
 */
export function createConveyorClient<TRouter extends Router>(): ConveyorClient<TRouter> {
  const bridge = window.conveyor
  const moduleCache = new Map<string, unknown>()

  return new Proxy({} as ConveyorClient<TRouter>, {
    get(_target, moduleId) {
      if (typeof moduleId !== 'string') return undefined
      const cached = moduleCache.get(moduleId)
      if (cached) return cached

      const channel = `conveyor:${moduleId}`
      const methodCache = new Map<string, unknown>()

      const moduleProxy = new Proxy(
        {},
        {
          get(_t, method) {
            if (typeof method !== 'string') return undefined
            const hit = methodCache.get(method)
            if (hit) return hit

            const member = async (...args: unknown[]) => {
              const res = (await bridge.invoke(channel, method, ...args)) as ConveyorResult<unknown>
              if (res && typeof res === 'object' && 'ok' in res) {
                if (res.ok) return res.data
                throw new ConveyorError(res.error)
              }
              return res
            }
            member.subscribe = (listener: (payload: unknown) => void): Unsubscribe =>
              bridge.subscribe(`conveyor:event:${moduleId}:${method}`, listener)

            methodCache.set(method, member)
            return member
          },
        }
      )

      moduleCache.set(moduleId, moduleProxy)
      return moduleProxy
    },
  })
}
