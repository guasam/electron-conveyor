/**
 * Single source of the IPC channel naming scheme — imported by both main and renderer so the two
 * processes can never drift on a channel string. Pure (no electron), safe anywhere.
 */
export const channels = {
  /** Procedure module channel (dispatched by method). */
  procedure: (moduleId: string) => `conveyor:${moduleId}`,
  /** Main→renderer event channel. */
  event: (moduleId: string, name: string) => `conveyor:event:${moduleId}:${name}`,
  /** Per-call stream channel main pushes chunks on. */
  stream: (streamId: string) => `conveyor:stream:${streamId}`,
  /** Store request channel (invoke `__get__` or an action). */
  store: (storeId: string) => `conveyor:store:${storeId}`,
  /** Store change-broadcast channel. */
  storeChanged: (storeId: string) => `conveyor:store:${storeId}:changed`,
} as const

/** Global stream lifecycle channels. */
export const STREAM_START = 'conveyor:stream:start'
export const STREAM_CANCEL = 'conveyor:stream:cancel'

/** Reserved store method that returns the current state. */
export const STORE_GET = '__get__'

/**
 * Kind manifest channel. The renderer fetches it once (synchronously, at first client call) so the
 * client knows whether each member is a query/command (Promise), stream (AsyncIterable), or event —
 * which is what lets calls return the real thing instead of a dual-purpose handle.
 */
export const MANIFEST = 'conveyor:manifest'
