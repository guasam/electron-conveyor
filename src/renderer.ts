/**
 * Renderer-only entry — everything the renderer needs to consume the conveyor.
 *
 *   import { createConveyorClient, createConveyorHooks, useConveyorStore } from 'electron-conveyor/renderer'
 */
export { createConveyorClient } from './renderer/client'
export type { ConveyorBridge } from './renderer/client'
export { createConveyorHooks } from './renderer/hooks'
export type { ConveyorHooks, ConveyorQueryHook, ConveyorMutationHook, ConveyorEventHook } from './renderer/hooks'
export { useConveyorStore, useConveyorActions } from './renderer/store-client'
export { ConveyorError } from './core/errors'
export type { ConveyorErrorCode, ConveyorErrorPayload } from './core/types'
