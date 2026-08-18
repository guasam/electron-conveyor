import { contextBridge, ipcRenderer } from 'electron'
import type { ConveyorBridge } from '../renderer/client'

/**
 * Expose the minimal conveyor bridge to the renderer — just `invoke` + `subscribe`, no Zod, so the
 * preload stays tiny and `sandbox`-compatible. The typed client Proxy is built renderer-side over it.
 */
export function exposeConveyor(): void {
  const bridge: ConveyorBridge = {
    invoke: (channel, method, ...args) => ipcRenderer.invoke(channel, method, ...args),
    subscribe: (channel, cb) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => cb(payload)
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },
  }

  if (process.contextIsolated) {
    contextBridge.exposeInMainWorld('conveyor', bridge)
  } else {
    window.conveyor = bridge
  }
}
