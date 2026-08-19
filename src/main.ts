/**
 * Main-process entry — one import site for the router, emitter, stores, and window manager.
 *
 *   import { createRouter, createEmitter, registerStore, createWindowManager } from 'electron-conveyor/main'
 */
export { createRouter } from './main/router'
export type { RouterOptions } from './main/router'
export { createEmitter } from './main/emitter'
export { registerStore } from './main/store-main'
export type { StoreHandle } from './main/store-main'
export { createWindowManager, resolveTargets } from './main/window-manager'
export type { EmitTarget, ConveyorWindowManager } from './main/window-manager'
