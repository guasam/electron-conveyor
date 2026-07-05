import type { BrowserWindow, WebContents } from 'electron'

/**
 * Where an event is emitted. Either a single window, or a resolver returning the current set of
 * target windows (so `broadcast` / `to(label)` / `except(sender)` stay live as windows come and go).
 */
export type EmitTarget = BrowserWindow | (() => BrowserWindow[])

/** Normalize a target to the live, non-destroyed windows to send to. Pure — no electron runtime. */
export function resolveTargets(target: EmitTarget): BrowserWindow[] {
  const wins = typeof target === 'function' ? target() : [target]
  return wins.filter((w): w is BrowserWindow => !!w && !w.isDestroyed())
}

/** A label→window registry that also produces `EmitTarget` resolvers for typed fan-out. */
export interface ConveyorWindowManager {
  /** Track a window under a label; auto-untracked when it closes. Returns the window. */
  register(label: string, win: BrowserWindow): BrowserWindow
  get(label: string): BrowserWindow | undefined
  all(): BrowserWindow[]
  labels(): string[]
  /** Target resolver for the window at `label` (empty if gone). */
  to(label: string): () => BrowserWindow[]
  /** Target resolver for every tracked, live window. */
  broadcast(): BrowserWindow[]
  /** Target resolver for all tracked windows except the one owning `sender`. */
  except(sender: WebContents): () => BrowserWindow[]
}

export function createWindowManager(): ConveyorWindowManager {
  const windows = new Map<string, BrowserWindow>()

  const manager: ConveyorWindowManager = {
    register(label, win) {
      windows.set(label, win)
      win.on('closed', () => {
        if (windows.get(label) === win) windows.delete(label)
      })
      return win
    },
    get: (label) => windows.get(label),
    all: () => [...windows.values()].filter((w) => !w.isDestroyed()),
    labels: () => [...windows.keys()],
    to: (label) => () => {
      const win = windows.get(label)
      return win ? [win] : []
    },
    broadcast: () => manager.all(),
    except: (sender) => () => manager.all().filter((w) => w.webContents !== sender),
  }

  return manager
}
