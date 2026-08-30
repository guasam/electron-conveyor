/**
 * Renderer entry, React-free — the plain typed client. React apps import from
 * 'electron-conveyor/react' instead (the same client plus per-member hooks).
 *
 *   import { createConveyorClient } from 'electron-conveyor/renderer'
 */
export { createConveyorClient } from './renderer/client'
export type { ConveyorBridge } from './renderer/client'
export { ConveyorError } from './core/errors'
export type {
  ConveyorClient,
  ConveyorErrorCode,
  ConveyorErrorPayload,
  ReservedErrorCode,
  RouterManifest,
  Unsubscribe,
} from './core/types'
