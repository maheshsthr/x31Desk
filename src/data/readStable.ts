/**
 * Reads a collection, retrying when a mutation lands while the read is in
 * flight, and applies the result only when it is still the current state.
 *
 * Storage reads are asynchronous by contract. The localStorage adapter happens
 * to resolve within the same tick, so a bulk load and a mutation never overlap
 * today — but a future adapter (SQLite over IPC) will not be so quick, and then
 * a load that started before a mutation can resolve *after* it. Applying that
 * stale result would discard the newer in-memory change: a note created a moment
 * ago, a task just deleted, a record just restored.
 *
 * The guard is a monotonic revision counter owned by each store. Every mutation
 * bumps it once its write has completed. A read is only applied when the counter
 * is unchanged across the whole read; otherwise the read is stale and is retried
 * against the current storage.
 *
 * The caller passes an `apply` callback rather than receiving the value, because
 * the check and the apply must happen in the same tick. If the value were
 * returned, the caller would apply it in a later microtask and a mutation's own
 * state update could slip in between — reordering two writes that this function
 * exists to order safely.
 *
 * `revision` is a getter rather than a value so it is observed when each read
 * runs, not when the call was set up.
 */
export async function readStable<T>(
  read: () => Promise<T>,
  revision: () => number,
  apply: (value: T) => void,
  options: { maxAttempts?: number } = {},
): Promise<void> {
  const maxAttempts = options.maxAttempts ?? 5

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const before = revision()
    const value = await read()

    if (revision() === before) {
      apply(value)
      return
    }
  }

  // Safety valve: if mutations kept landing, apply one final read rather than
  // looping forever. It is at least as fresh as every earlier attempt, and any
  // mutation that lands after it reconciles the in-memory state itself.
  apply(await read())
}
