/**
 * Authoring primitives — pure, no electron/react/zustand runtime, importable in ANY process.
 * Use these to *define* IPC surface (modules, procedures, events, stores).
 *
 *   import { defineModule, procedure, event, defineStore } from 'electron-conveyor/define'  // zero-context
 *   import { initConveyor } from 'electron-conveyor/define'                                 // typed context
 */
export { initConveyor } from './authoring/init'
export type { ConveyorApi } from './authoring/init'
export { defineModule } from './authoring/module'
export { procedure } from './authoring/procedure'
export type { ProcedureBuilder } from './authoring/procedure'
export { event } from './authoring/event'
export { defineStore } from './authoring/store'

export type { StandardSchemaV1 } from './core/standard-schema'
export type {
  BaseContext,
  HandlerContext,
  Middleware,
  MwMarker,
  NextFn,
  AnyMiddleware,
  ProcedureDef,
  EventDef,
  AnyDef,
  Module,
  ModuleRecord,
  Router,
  ConveyorClient,
  EventEmitters,
  Unsubscribe,
} from './core/types'
export type { StoreDef, StoreActions, StoreActionsClient, ConveyorStore } from './authoring/store'
