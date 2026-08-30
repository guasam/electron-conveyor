import type { MemberKind, ModuleMap, RouterManifest } from './types'

/**
 * Build the kind manifest the renderer client bootstraps from: which members exist per module and
 * whether each is a query/command, stream, or event. Kinds only — schemas and handlers never leave
 * main. Pure — no electron.
 */
export function buildManifest(modules: ModuleMap): RouterManifest {
  const manifest: RouterManifest = {}
  for (const key of Object.keys(modules)) {
    const entry: Record<string, MemberKind> = {}
    const record = modules[key].record
    for (const method of Object.keys(record)) entry[method] = record[method].kind
    manifest[key] = entry
  }
  return manifest
}
