/**
 * React entry — the typed client with per-member hooks attached (`.useQuery()`, `.useMutation()`,
 * `.useStream()`, `.useEvent()`, typed `invalidate()`), plus the cross-window store hooks.
 *
 *   import { createConveyorReactClient, useConveyorStore } from 'electron-conveyor/react'
 */
export { createConveyorReactClient } from './react/client'
export type {
  ConveyorReactClient,
  ConveyorReactMember,
  ReactClientOptions,
  QueryMember,
  QueryInvalidator,
  CommandMember,
  StreamMember,
  EventMember,
  QueryOpts,
  MutationOpts,
  StreamHandlers,
} from './react/client'
export { useConveyorStore, useConveyorActions } from './react/store'
export { ConveyorError } from './core/errors'
export type { ConveyorBridge } from './renderer/client'
export type { ConveyorErrorCode, ConveyorErrorPayload, ReservedErrorCode, Unsubscribe } from './core/types'
