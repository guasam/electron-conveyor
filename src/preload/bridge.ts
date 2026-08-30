import { contextBridge, ipcRenderer } from 'electron'
import { MANIFEST } from '../core/channels'
import type { ConveyorBridge } from '../renderer/client'
import type { RouterManifest } from '../core/types'

/**
 * Expose the minimal conveyor bridge to the renderer — `invoke` + `subscribe` + a one-shot
 * synchronous `manifest` read, no schemas — so the preload stays tiny and `sandbox`-compatible.
 * The typed client Proxy is built renderer-side over it.
 */
export function exposeConveyor(): void {
  const bridge: ConveyorBridge = {
    invoke: (channel, method, ...args) => ipcRenderer.invoke(channel, method, ...args),
    subscribe: (channel, cb) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => cb(payload)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },
    // sendSync is fine here: the client calls it once at startup (then caches), and main answers
    // from memory — this is what lets calls know their kind synchronously.
    manifest: () => ipcRenderer.sendSync(MANIFEST) as RouterManifest,
  }

  if (process.contextIsolated) {
    contextBridge.exposeInMainWorld('conveyor', bridge)
  } else {
    window.conveyor = bridge
  }
}
