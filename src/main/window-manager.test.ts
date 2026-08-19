import { describe, it, expect } from 'vitest'
import { createWindowManager, resolveTargets } from './window-manager'
import type { BrowserWindow } from 'electron'

// Structural fake — the manager/resolvers only touch isDestroyed/webContents/on/close.
function fakeWin() {
  let destroyed = false
  const closedCbs: Array<() => void> = []
  const win = {
    webContents: {},
    isDestroyed: () => destroyed,
    on: (ev: string, cb: () => void) => {
      if (ev === 'closed') closedCbs.push(cb)
      return win
    },
    close: () => {
      destroyed = true
      closedCbs.forEach((f) => f())
    },
  }
  return win as unknown as BrowserWindow
}

describe('createWindowManager', () => {
  it('registers, gets, lists', () => {
    const m = createWindowManager()
    const a = fakeWin()
    const b = fakeWin()
    m.register('a', a)
    m.register('b', b)
    expect(m.get('a')).toBe(a)
    expect(m.labels().sort()).toEqual(['a', 'b'])
    expect(m.all()).toHaveLength(2)
  })

  it('untracks a window when it closes', () => {
    const m = createWindowManager()
    const a = fakeWin()
    m.register('a', a)
    ;(a as unknown as { close: () => void }).close()
    expect(m.get('a')).toBeUndefined()
    expect(m.labels()).toEqual([])
    expect(m.to('a')()).toEqual([])
  })

  it('to(label) resolves to that window (empty if gone)', () => {
    const m = createWindowManager()
    const a = fakeWin()
    m.register('a', a)
    expect(m.to('a')()).toEqual([a])
    expect(m.to('nope')()).toEqual([])
  })

  it('broadcast targets all live windows', () => {
    const m = createWindowManager()
    const a = fakeWin()
    const b = fakeWin()
    m.register('a', a)
    m.register('b', b)
    expect(m.broadcast()).toEqual([a, b])
  })

  it('except(sender) excludes the sender window', () => {
    const m = createWindowManager()
    const a = fakeWin()
    const b = fakeWin()
    m.register('a', a)
    m.register('b', b)
    expect(m.except(a.webContents)()).toEqual([b])
  })
})

describe('resolveTargets', () => {
  it('accepts a single window', () => {
    const a = fakeWin()
    expect(resolveTargets(a)).toEqual([a])
  })

  it('accepts a resolver and drops destroyed / nullish windows', () => {
    const a = fakeWin()
    const b = fakeWin()
    ;(b as unknown as { close: () => void }).close()
    expect(resolveTargets(() => [a, b, null as unknown as BrowserWindow])).toEqual([a])
  })
})
