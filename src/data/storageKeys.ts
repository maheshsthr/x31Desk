/**
 * The canonical `localStorage` keys for the workspace.
 * ---------------------------------------------------------------------------
 * Every reader and writer addresses storage through this one record, so the
 * cross-tab watcher and the repositories can never drift apart: a key renamed
 * here moves everywhere at once, and a watcher can always name the exact key a
 * repository writes.
 *
 * The values are the product namespace, `x31desk:`, grouped by what they hold —
 * the four record collections, the two preferences and the schema marker —
 * because that is how the application talks about them.
 */
export const STORAGE_KEYS = {
  notes: 'x31desk:notes',
  tasks: 'x31desk:tasks',
  snippets: 'x31desk:snippets',
  archive: 'x31desk:archive',
  theme: 'x31desk:theme',
  editor: 'x31desk:editor',
  schema: 'x31desk:schema',
} as const
