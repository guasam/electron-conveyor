import type { ConveyorErrorCode, ConveyorErrorPayload } from './types'

/** Extract a message from an unknown thrown value. */
export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/**
 * Thrown in the renderer when a procedure fails in main. Carries the real message, a stable `code`,
 * and (for validation failures) the Standard Schema `issues` — so callers can branch on `err.code`.
 */
export class ConveyorError extends Error {
  readonly code: ConveyorErrorCode
  readonly issues?: unknown

  constructor(payload: ConveyorErrorPayload) {
    super(payload.message)
    this.name = 'ConveyorError'
    this.code = payload.code
    this.issues = payload.issues
  }
}
