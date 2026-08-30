import type { Middleware } from '../core/types'
import { isDev } from './env'

/**
 * Router-global request logging for development: one line per call with the path and duration
 * (`[conveyor] secure.readSecret (1.3ms)`). A no-op in packaged builds. Install via
 * `createRouter(modules, { use: [devLogger] })`.
 */
export const devLogger: Middleware<object, object> = async ({ path, type, next }) => {
  if (!isDev) return next()
  const start = performance.now()
  try {
    return await next()
  } finally {
    console.log(`[conveyor] ${type} ${path} (${(performance.now() - start).toFixed(1)}ms)`)
  }
}
