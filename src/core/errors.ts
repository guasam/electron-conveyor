import type { ConveyorErrorPayload } from './types'

/**
 * The typed error that crosses the IPC boundary in both directions.
 *
 * - **Throw it in a handler** to send a custom code to the renderer:
 *   `throw new ConveyorError('UNAUTHORIZED', 'Unlock first')` — dispatch puts the code straight
 *   into the error envelope instead of collapsing it to `HANDLER_ERROR`.
 * - **Catch it in the renderer** and branch on `err.code`; validation failures carry the
 *   Standard Schema `issues` for field-level detail.
 */
export class ConveyorError extends Error {
  readonly code: string
  readonly issues?: unknown

  constructor(code: string, message?: string, issues?: unknown) {
    super(message ?? code)
    this.name = 'ConveyorError'
    this.code = code
    this.issues = issues
  }

  static from(payload: ConveyorErrorPayload): ConveyorError {
    return new ConveyorError(payload.code, payload.message, payload.issues)
  }
}

export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err))
