/**
 * Authoring primitives — pure, no electron/react/zustand runtime, importable in ANY process.
 * Use these to *define* IPC surface (modules, queries/commands/streams, events, stores).
 *
 *   import { query, command, stream, event, defineModule } from 'electron-conveyor/define' // zero-context
 *   import { initConveyor } from 'electron-conveyor/define'                                // typed context
 */
export { initConveyor } from './authoring/init'
export type { ConveyorApi } from './authoring/init'
export { defineModule } from './authoring/module'
export { query, command, stream } from './authoring/primitives'
export type { ProcedureFactory, StreamFactory } from './authoring/primitives'
export { event } from './authoring/event'
export { defineStore } from './authoring/store'
export { ConveyorError } from './core/errors'
export { createCaller } from './core/caller'
export type { ConveyorCaller, CallerOptions } from './core/caller'
export { buildManifest } from './core/manifest'

export type { StandardSchemaV1 } from './core/standard-schema'
export type {
  BaseContext,
  Middleware,
  MwMarker,
  NextFn,
  AnyMiddleware,
  ProcedureKind,
  MemberKind,
  ProcedureDef,
  StreamDef,
  EventDef,
  AnyDef,
  Module,
  ModuleRecord,
  ModuleMap,
  AppCtxOf,
  Router,
  RouterManifest,
  ConveyorClient,
  EventEmitters,
  Unsubscribe,
  ReservedErrorCode,
  ConveyorErrorCode,
  ConveyorErrorPayload,
  ConveyorResult,
} from './core/types'
export type {
  StoreDef,
  AnyStoreDef,
  StoreActions,
  StoreActionsFor,
  StoreSchemaMap,
  StoreActionsClient,
  ConveyorStore,
} from './authoring/store'
