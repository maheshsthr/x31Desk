/**
 * x31Desk — unwrapping an IPC result in the renderer.
 * ---------------------------------------------------------------------------
 * A data call resolves with the plain `IpcResult` envelope the main process
 * built. The envelope is intentionally plain data: a `StorageError` created in
 * the sandboxed preload would lose its prototype and its `kind` when it crossed
 * `contextBridge`, so the failure classifier is applied *here*, in the renderer,
 * where the real `StorageError` class lives.
 *
 * This is the single seam every IPC-backed repository adapter goes through, so
 * a failure reaches the UI as exactly the same tagged error a `localStorage`
 * failure does, and the existing error handling keeps working unchanged.
 */

import type { IpcResult } from '@/data/ipc/contract'
import { StorageError } from '@/data/storageError'

/**
 * Returns the successful value, or throws the {@link StorageError} that matches
 * the envelope's kind.
 */
export function unwrapIpcResult<T>(result: IpcResult<T>): T {
  if (result.ok) {
    return result.value
  }

  throw new StorageError(result.kind)
}
