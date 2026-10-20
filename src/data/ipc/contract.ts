/**
 * The typed IPC contract shared by the main process, the sandboxed preload and
 * the renderer.
 * ---------------------------------------------------------------------------
 * Every capability the shell publishes is named here exactly once. The main
 * process registers a `ipcMain.handle` for a channel, the preload invokes it by
 * the same constant, and the renderer's repository adapters will be typed by
 * the request and response shapes below. Because all three read this one
 * module, a channel can never be renamed on one side and left behind on another
 * — which is precisely what the hand-mirrored constants used to risk.
 *
 * This module is deliberately runtime-safe for the sandboxed preload: it holds
 * string constants and *types only*. The record imports are `import type`, so
 * they are erased at build time and never drag application code into the
 * preload bundle.
 *
 * The names are also the whole of the renderer's reach: there is no
 * `invoke(channel, …)` helper anywhere, so a renderer can call only the
 * capabilities that were explicitly published, never an arbitrary handler.
 */

import type { StorageErrorKind } from '@/data/storageError'
import type { ArchivedItem, ArchiveItemType } from '@/types/archive'
import type { EditorPreferences } from '@/types/editorPreferences'
import type { Note, NoteDraft } from '@/types/note'
import type { Snippet, SnippetDraft } from '@/types/snippet'
import type { Task, TaskDraft } from '@/types/task'
import type { ThemePreference } from '@/types/theme'

/**
 * The product namespace every application channel begins with, so an
 * application channel is never confused with one of Electron's own.
 */
export const IPC_CHANNEL_PREFIX = 'x31desk:'

/**
 * The one place a channel name is written down.
 *
 * The keys are listed capability by capability; the values are the literal names
 * that travel on the wire. `as const` keeps each value a string literal so
 * {@link IpcChannel} and {@link IpcContract} can be built from them.
 */
export const IPC_CHANNELS = {
  /** Read-only shell versions, shown on the About surface. */
  appInfo: 'x31desk:app-info',

  /** `NoteRepository` operations. */
  notesList: 'x31desk:notes.list',
  notesCreate: 'x31desk:notes.create',
  notesUpdate: 'x31desk:notes.update',
  notesInsert: 'x31desk:notes.insert',
  notesRemove: 'x31desk:notes.remove',
  notesClear: 'x31desk:notes.clear',

  /** `TaskRepository` operations. */
  tasksList: 'x31desk:tasks.list',
  tasksCreate: 'x31desk:tasks.create',
  tasksUpdate: 'x31desk:tasks.update',
  tasksSetCompleted: 'x31desk:tasks.setCompleted',
  tasksInsert: 'x31desk:tasks.insert',
  tasksRemove: 'x31desk:tasks.remove',
  tasksClear: 'x31desk:tasks.clear',

  /** `SnippetRepository` operations. */
  snippetsList: 'x31desk:snippets.list',
  snippetsCreate: 'x31desk:snippets.create',
  snippetsUpdate: 'x31desk:snippets.update',
  snippetsInsert: 'x31desk:snippets.insert',
  snippetsRemove: 'x31desk:snippets.remove',
  snippetsClear: 'x31desk:snippets.clear',

  /** `ArchiveRepository` operations. */
  archiveList: 'x31desk:archive.list',
  archiveAdd: 'x31desk:archive.add',
  archiveRemove: 'x31desk:archive.remove',
  archiveClear: 'x31desk:archive.clear',

  /**
   * The archive corruption vault, read-only. Not a repository operation: it is
   * the recovery surface for an archive row the adapter could not read back.
   */
  archiveCorruption: 'x31desk:archive.corruption',

  /** The one-time `localStorage` → SQLite import. Not a repository operation. */
  migrationStatus: 'x31desk:migration.status',
  migrationImport: 'x31desk:migration.import',

  /**
   * The close handshake. Main sends `flushRequest` to the renderer when the
   * window is closing; the renderer answers `flushResult` once every pending
   * write has settled. Neither is a repository operation.
   */
  flushRequest: 'x31desk:lifecycle.flush-request',
  flushResult: 'x31desk:lifecycle.flush-result',

  /**
   * The shell's native chrome theme — the Windows title bar today. The renderer
   * carries the app's theme preference here so the native title bar follows the
   * application's light/dark choice, which can differ from the operating
   * system's. Not a repository operation.
   */
  themeSetSource: 'x31desk:theme.set-source',

  /**
   * Backup and restore of the whole workspace. Not repository operations: each
   * one drives a native file dialog and a whole-database snapshot, so they live
   * apart from `repositoryHandlers.ts` and are registered by their own function,
   * exactly like the migration handlers.
   */
  backupExport: 'x31desk:backup.export',
  backupInspect: 'x31desk:backup.inspect',
  backupApply: 'x31desk:backup.apply',

  /**
   * The frameless window behind the custom title bar: three validated actions
   * (minimize, maximize/restore, close), one state read for the first paint and
   * one main → renderer push that keeps the maximize button in step when the
   * user drags, snaps or double-clicks the title bar. Not repository
   * operations.
   */
  windowMinimize: 'x31desk:window.minimize',
  windowToggleMaximize: 'x31desk:window.toggle-maximize',
  windowClose: 'x31desk:window.close',
  windowState: 'x31desk:window.state',
  windowMaximizedChanged: 'x31desk:window.maximized-changed',
} as const

/** Every channel name, as a union of its literal strings. */
export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

/**
 * The channels that are not repository operations: the shell's own
 * capabilities. They are registered by their own modules rather than by the
 * repository handler map, so they are named here to keep that split explicit
 * (and to let a test assert the repository map holds exactly the rest).
 */
export const SHELL_CHANNELS = [
  IPC_CHANNELS.appInfo,
  IPC_CHANNELS.archiveCorruption,
  IPC_CHANNELS.migrationStatus,
  IPC_CHANNELS.migrationImport,
  IPC_CHANNELS.flushRequest,
  IPC_CHANNELS.flushResult,
  IPC_CHANNELS.themeSetSource,
  IPC_CHANNELS.backupExport,
  IPC_CHANNELS.backupInspect,
  IPC_CHANNELS.backupApply,
  IPC_CHANNELS.windowMinimize,
  IPC_CHANNELS.windowToggleMaximize,
  IPC_CHANNELS.windowClose,
  IPC_CHANNELS.windowState,
  IPC_CHANNELS.windowMaximizedChanged,
] as const

/** The versions the main process reports for the running shell. */
export type AppInfoResponse = {
  /** The application version, from `package.json`. */
  readonly appVersion: string
  /** The bundled Electron version. */
  readonly electron: string
  /** The bundled Chromium version. */
  readonly chrome: string
  /** The Node.js version embedded in the main process. */
  readonly node: string
  /** `process.platform` in the main process, e.g. `"win32"`. */
  readonly platform: string
}

/**
 * A successful result envelope for a data channel.
 *
 * Request payloads are always a single object (never positional arguments), so
 * a handler can validate one well-known shape. Responses are the raw value when
 * an operation cannot fail and an {@link IpcResult} when it can: a failure is
 * reduced to a {@link StorageErrorKind} in the main process, which the renderer
 * adapter turns back into its own `StorageError`, so the existing storage-error
 * handling keeps working unchanged. Raw SQLite messages and database paths
 * never cross this boundary.
 */
export type IpcOk<T> = { readonly ok: true; readonly value: T }

/** A failed result envelope, reduced to a kind the renderer already knows. */
export type IpcFailure = { readonly ok: false; readonly kind: StorageErrorKind }

/** The result of a fallible data channel. */
export type IpcResult<T> = IpcOk<T> | IpcFailure

/**
 * The four collections the one-time import moves out of `localStorage`.
 *
 * Named once so the renderer's source reader, the main process's importer and
 * the report all agree on the set and its spelling.
 */
export const MIGRATION_COLLECTIONS = ['notes', 'tasks', 'snippets', 'archive'] as const

/** One of the four imported collections. */
export type MigrationCollectionName = (typeof MIGRATION_COLLECTIONS)[number]

/**
 * The records the renderer reads from `localStorage` and hands to the main
 * process for import.
 *
 * Every record has already passed the application's own guards — the renderer
 * will not send a collection it could not fully understand — so the main
 * process re-checks the shape only because IPC input is untrusted, never
 * because it expects to reject it.
 */
export type MigrationSource = {
  readonly notes: readonly Note[]
  readonly tasks: readonly Task[]
  readonly snippets: readonly Snippet[]
  readonly archive: readonly ArchivedItem[]
}

/** How many records of each collection were imported. */
export type MigrationRecordCounts = {
  readonly notes: number
  readonly tasks: number
  readonly snippets: number
  readonly archive: number
}

/** One source record that could not be reconciled with the destination. */
export type MigrationConflict = {
  readonly collection: MigrationCollectionName
  /** The record's id, or `type:recordId` for an archived item. */
  readonly id: string
}

/**
 * The state of the one-time import, as recorded in the database.
 *
 * `not-started` covers both a fresh database and one whose marker was never
 * written; `unavailable` means the database could not be opened, so the state
 * cannot be read at all.
 */
export type MigrationStatusResult =
  | { readonly status: 'not-started' }
  | { readonly status: 'completed'; readonly completedAt: number; readonly counts: MigrationRecordCounts }
  | { readonly status: 'unavailable' }

/**
 * The outcome of an import attempt.
 *
 * This is a plain result rather than an {@link IpcResult} because a conflict, an
 * invalid source or a verification failure is a *successful call* that reports a
 * decision, not a transport failure. Only a database-level failure that maps to
 * a {@link StorageErrorKind} is reduced to `failed`, keeping the storage-error
 * vocabulary the renderer already understands. No SQLite message, SQL or path is
 * ever part of an outcome.
 */
export type MigrationOutcome =
  | {
      readonly outcome: 'completed'
      readonly counts: MigrationRecordCounts
      /** True when the import had already finished and nothing was written. */
      readonly alreadyCompleted: boolean
    }
  | { readonly outcome: 'invalid-source'; readonly collections: readonly MigrationCollectionName[] }
  | { readonly outcome: 'conflict'; readonly conflicts: readonly MigrationConflict[] }
  | { readonly outcome: 'verification-failed' }
  | { readonly outcome: 'unavailable' }
  | { readonly outcome: 'failed'; readonly kind: StorageErrorKind }

// ---------------------------------------------------------------------------
// backup and restore
// ---------------------------------------------------------------------------

/**
 * The magic string a backup document begins with.
 *
 * The first thing a reader checks, so a file that is not a backup at all — a
 * recovery export, a JSON blob, a photograph — is refused before any of its
 * contents are looked at.
 */
export const BACKUP_FORMAT = 'x31desk.backup'

/**
 * The version of {@link BACKUP_FORMAT} this build writes *and* reads.
 *
 * Only one version exists so far, and the reader refuses anything else rather
 * than guessing: a document from a later build may describe records this one
 * cannot represent, and importing it partially would be worse than not
 * importing it. A later release that changes the shape raises this number and
 * decides then whether to accept the older one.
 */
export const BACKUP_FORMAT_VERSION = 1

/**
 * The ways a backup can be brought into the workspace.
 *
 * `merge` is the safe default: it adds what the workspace does not already
 * have and reports — never overwrites — a record whose id it already holds with
 * different content. `replace` clears the four collections first and is only
 * ever reached through an explicit confirmation.
 */
export const BACKUP_IMPORT_MODES = ['merge', 'replace'] as const

/** One of the two ways a backup can be applied. */
export type BackupImportMode = (typeof BACKUP_IMPORT_MODES)[number]

/**
 * The preferences a backup can carry alongside the records.
 *
 * Every field is optional, and "absent" is meaningful: a key that is not in the
 * document leaves the workspace's current value alone, so a backup taken before
 * a setting existed does not silently reset it on restore.
 *
 * The converse also holds, and is what keeps old files readable. A document may
 * carry keys this build does not know about — most importantly the retired
 * `uiScale` preference, written by versions that shipped a UI Scale setting —
 * and an unknown key is ignored rather than treated as damage. Validation reads
 * the fields it knows and leaves the rest alone, so a backup written years ago
 * still imports; only its theme and editor preferences are applied.
 */
export type BackupPreferences = {
  readonly theme?: ThemePreference
  readonly editor?: EditorPreferences
}

/**
 * A whole-workspace snapshot, as written to a `.x31backup` file.
 *
 * The records are exactly the application's own types — ids, timestamps, tags
 * and completion state all intact — because the file is a faithful copy rather
 * than an interchange format. `counts` is redundant with the arrays and is
 * checked against them on read: a mismatch means the document was truncated or
 * edited, and is refused rather than imported half-trusted.
 */
export type BackupDocument = {
  readonly format: typeof BACKUP_FORMAT
  readonly formatVersion: typeof BACKUP_FORMAT_VERSION
  /** The application version that wrote the file. Informational. */
  readonly appVersion: string
  /** The SQLite schema version the file was written against. Informational. */
  readonly databaseVersion: number
  /** When the export ran, as an ISO 8601 timestamp. */
  readonly exportedAt: string
  readonly counts: MigrationRecordCounts
  readonly notes: readonly Note[]
  readonly tasks: readonly Task[]
  readonly snippets: readonly Snippet[]
  readonly archive: readonly ArchivedItem[]
  /** Omitted entirely when the workspace had no preferences to attach. */
  readonly preferences?: BackupPreferences
}

/** What the Settings page shows before an import is committed. */
export type BackupPreview = {
  /** The application version that wrote the file. */
  readonly appVersion: string
  /** When the export ran, as an ISO 8601 timestamp. */
  readonly exportedAt: string
  readonly counts: MigrationRecordCounts
  /** Whether the file carries preferences that a restore would apply. */
  readonly hasPreferences: boolean
}

/** Why a chosen file was refused, and the sentence shown to the user. */
export type BackupRejectionReason =
  | 'not-a-backup'
  | 'unsupported-version'
  | 'malformed'
  | 'too-large'
  | 'too-many-records'

/**
 * The outcome of an export attempt.
 *
 * A plain result rather than an {@link IpcResult}: cancelling a dialog, refusing
 * a file and writing one are all *decisions* the operation reports. Only an
 * unexpected I/O or database error is reduced to a `StorageErrorKind`, keeping
 * the vocabulary the renderer's storage-error handling already understands. No
 * SQLite message, SQL or filesystem path is ever part of an outcome beyond the
 * path the user themselves chose in the save dialog.
 */
export type BackupExportOutcome =
  | { readonly outcome: 'cancelled' }
  | {
      readonly outcome: 'written'
      /** The absolute path the user chose. Echoed back for the success message. */
      readonly path: string
      readonly fileName: string
      readonly counts: MigrationRecordCounts
      /** The size of the file that was written, in bytes. */
      readonly bytes: number
      /**
       * Archive rows present in the database whose payload could not be read
       * back, and so could not be copied into the file. They stay in the
       * database and remain exportable through "Export unreadable data".
       */
      readonly unreadableArchiveRows: number
      readonly preferencesIncluded: boolean
    }
  | { readonly outcome: 'failed'; readonly kind: StorageErrorKind }

/** The outcome of reading and validating a chosen file, before any write. */
export type BackupInspectOutcome =
  | { readonly outcome: 'cancelled' }
  | {
      readonly outcome: 'rejected'
      readonly reason: BackupRejectionReason
      /** A short, safe sentence. Never a stack trace or a SQLite message. */
      readonly message: string
    }
  | {
      readonly outcome: 'ready'
      readonly fileName: string
      readonly preview: BackupPreview
      /**
       * The validated document, handed back so the apply call can carry it
       * without the main process having to remember which file was picked.
       */
      readonly document: BackupDocument
    }
  | { readonly outcome: 'failed'; readonly kind: StorageErrorKind }

/**
 * One record whose id the workspace already holds with different content.
 *
 * In a merge it is reported and left exactly as it was — the workspace copy
 * wins, always — so nothing the user has done locally is silently replaced.
 */
export type BackupConflict = {
  readonly collection: MigrationCollectionName
  /** The record's id, or `type:recordId` for an archived item. */
  readonly id: string
}

/** The outcome of applying an inspected backup. */
export type BackupApplyOutcome =
  | {
      readonly outcome: 'applied'
      readonly mode: BackupImportMode
      /** Records the workspace gained — absent from it before this import. */
      readonly counts: MigrationRecordCounts
      /** Records the workspace already held identically; left untouched. */
      readonly unchanged: MigrationRecordCounts
      /** Same id, different content. Reported, never overwritten. */
      readonly conflicts: readonly BackupConflict[]
      /**
       * The preferences to write into the renderer's own storage, already
       * sanitised, or `null` when the document carried none. The main process
       * has no access to `localStorage`, so the renderer applies these.
       */
      readonly preferences: BackupPreferences | null
    }
  | {
      readonly outcome: 'rejected'
      readonly reason: BackupRejectionReason
      readonly message: string
    }
  | { readonly outcome: 'failed'; readonly kind: StorageErrorKind }

/**
 * The renderer's answer to a close-handshake flush request.
 *
 * `ok` is `true` only when every pending write settled successfully. A failed or
 * timed-out flush is reported as `ok: false` (or never reported at all, which the
 * main process treats the same way) — a close is never told a write succeeded
 * that did not.
 */
export type FlushReport = { readonly ok: boolean }

/**
 * What the custom title bar needs to draw the maximize/restore button.
 *
 * `maximized` is authoritative from two directions: the renderer reads it once
 * on mount, and the main process pushes it whenever the window state moves
 * (including changes the renderer did not initiate — dragging to a screen edge,
 * snapping, the OS-side double-click), so the button can never show the wrong
 * glyph.
 */
export type WindowStateResult = {
  readonly maximized: boolean
}

/**
 * One archive row the SQLite adapter could not read back, preserved verbatim.
 *
 * This is the shape the corruption vault stores and the recovery export hands
 * to the user: `data` is the original column exactly as written, never parsed
 * or normalised, and the identity columns let the affected record be named
 * without reading the payload. The renderer only ever receives these over the
 * read-only {@link IPC_CHANNELS.archiveCorruption} channel.
 */
export type ArchiveCorruptionEntry = {
  /** The malformed row's `type` column. */
  readonly type: string
  /** The malformed row's `record_id` column. */
  readonly recordId: string
  /** The malformed row's `archived_at` column, which may be absent. */
  readonly archivedAt: number | null
  /** The original `data` column, verbatim. Never parsed or normalised. */
  readonly data: string
  /** When the row was first preserved, epoch milliseconds. */
  readonly detectedAt: number
}

/**
 * The request and response shapes for every channel.
 *
 * The keys are the channel constants themselves, so a channel cannot exist
 * without a declared shape and a shape cannot be declared for a name that is
 * not a channel. `request: void` marks a call that takes no arguments.
 */
export type IpcContract = {
  [IPC_CHANNELS.appInfo]: { request: void; response: AppInfoResponse }

  [IPC_CHANNELS.notesList]: { request: void; response: Note[] }
  [IPC_CHANNELS.notesCreate]: { request: void; response: Note }
  [IPC_CHANNELS.notesUpdate]: { request: { readonly id: string; readonly draft: NoteDraft }; response: Note | null }
  [IPC_CHANNELS.notesInsert]: { request: { readonly note: Note }; response: Note }
  [IPC_CHANNELS.notesRemove]: { request: { readonly id: string }; response: void }
  [IPC_CHANNELS.notesClear]: { request: void; response: void }

  [IPC_CHANNELS.tasksList]: { request: void; response: Task[] }
  [IPC_CHANNELS.tasksCreate]: { request: { readonly draft: TaskDraft }; response: Task }
  [IPC_CHANNELS.tasksUpdate]: { request: { readonly id: string; readonly draft: TaskDraft }; response: Task | null }
  [IPC_CHANNELS.tasksSetCompleted]: { request: { readonly id: string; readonly completed: boolean }; response: Task | null }
  [IPC_CHANNELS.tasksInsert]: { request: { readonly task: Task }; response: Task }
  [IPC_CHANNELS.tasksRemove]: { request: { readonly id: string }; response: void }
  [IPC_CHANNELS.tasksClear]: { request: void; response: void }

  [IPC_CHANNELS.snippetsList]: { request: void; response: Snippet[] }
  [IPC_CHANNELS.snippetsCreate]: { request: { readonly draft: SnippetDraft }; response: Snippet }
  [IPC_CHANNELS.snippetsUpdate]: { request: { readonly id: string; readonly draft: SnippetDraft }; response: Snippet | null }
  [IPC_CHANNELS.snippetsInsert]: { request: { readonly snippet: Snippet }; response: Snippet }
  [IPC_CHANNELS.snippetsRemove]: { request: { readonly id: string }; response: void }
  [IPC_CHANNELS.snippetsClear]: { request: void; response: void }

  [IPC_CHANNELS.archiveList]: { request: void; response: ArchivedItem[] }
  [IPC_CHANNELS.archiveAdd]: { request: { readonly entry: ArchivedItem }; response: ArchivedItem }
  [IPC_CHANNELS.archiveRemove]: { request: { readonly type: ArchiveItemType; readonly id: string }; response: void }
  [IPC_CHANNELS.archiveClear]: { request: void; response: void }

  [IPC_CHANNELS.archiveCorruption]: { request: void; response: ArchiveCorruptionEntry[] }

  [IPC_CHANNELS.migrationStatus]: { request: void; response: MigrationStatusResult }
  [IPC_CHANNELS.migrationImport]: { request: { readonly source: MigrationSource }; response: MigrationOutcome }

  /**
   * Backup and restore. Like the migration channels, these resolve with their
   * own typed outcome rather than an {@link IpcResult} envelope: cancelling a
   * dialog, refusing a file and applying one are decisions, not transport
   * failures. Only an unexpected I/O or database error becomes `failed`.
   */
  [IPC_CHANNELS.backupExport]: {
    request: { readonly preferences?: BackupPreferences }
    response: BackupExportOutcome
  }
  /** Takes no request: the main process opens the picker itself. */
  [IPC_CHANNELS.backupInspect]: { request: void; response: BackupInspectOutcome }
  [IPC_CHANNELS.backupApply]: {
    request: { readonly document: BackupDocument; readonly mode: BackupImportMode }
    response: BackupApplyOutcome
  }

  /** Main → renderer: "flush now, then answer". Carries no request value. */
  [IPC_CHANNELS.flushRequest]: { request: void; response: void }
  /** Renderer → main: the flush outcome. The handler resolves once recorded. */
  [IPC_CHANNELS.flushResult]: { request: FlushReport; response: void }

  /**
   * Renderer → main: the app's theme preference, mirrored onto the shell's
   * native chrome. The value is exactly `nativeTheme.themeSource`, so `system`
   * keeps the OS in charge and an explicit `light`/`dark` pins the native title
   * bar regardless of the OS.
   */
  [IPC_CHANNELS.themeSetSource]: {
    request: { readonly preference: ThemePreference }
    response: void
  }

  /**
   * Window controls for the frameless shell. Three actions take no arguments
   * and resolve with nothing — the main process performs the window operation
   * and the resulting state arrives on the pushed channel below. `windowClose`
   * goes through `BrowserWindow.close()`, so it takes exactly the same route as
   * the system close: the close handshake flushes the renderer first.
   */
  [IPC_CHANNELS.windowMinimize]: { request: void; response: void }
  [IPC_CHANNELS.windowToggleMaximize]: { request: void; response: void }
  [IPC_CHANNELS.windowClose]: { request: void; response: void }
  /** The initial state the renderer reads on mount, before any push arrives. */
  [IPC_CHANNELS.windowState]: { request: void; response: WindowStateResult }
  /** Main → renderer: the maximize state moved, however it was moved. */
  [IPC_CHANNELS.windowMaximizedChanged]: { request: void; response: WindowStateResult }
}

/** The arguments a channel accepts. `void` for a call that takes none. */
export type IpcRequest<C extends IpcChannel> = IpcContract[C]['request']

/** The value a channel resolves with on success. */
export type IpcResponse<C extends IpcChannel> = IpcContract[C]['response']
