/**
 * Generates a collision-resistant id for a new record.
 *
 * `crypto.randomUUID` requires a secure context. Both the dev server
 * (localhost) and the `file://` origin the packaged Electron build will use
 * satisfy that, so the fallback only covers unusual embeddings where the
 * global is unavailable.
 */
export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
