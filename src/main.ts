/**
 * Main-process entry — one import site for the router, emitter, stores, and window manager.
 *
 *   import { createRouter, createEmitter, createWindowManager, devLogger } from 'electron-conveyor/main'
 */
export { createRouter } from './main/router'
export { createEmitter } from './main/emitter'
export { registerStore } from './main/store-main'
export { createWindowManager, resolveTargets } from './main/window-manager'
export { devLogger } from './main/dev-logger'
export { createCaller } from './core/caller'
export { ConveyorError } from './core/errors'

export type { RouterOptions, StoreHandlesOf } from './main/router'
export type { StoreHandle } from './main/store-main'
export type { EmitTarget, ConveyorWindowManager } from './main/window-manager'
export type { ConveyorCaller, CallerOptions } from './core/caller'
