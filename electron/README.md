# x31Desk — Electron shell

This directory is the Electron shell that runs the existing React application as
a Windows desktop app. It opens a window, loads the renderer, and owns the
SQLite database. **On the desktop the workspace is stored in SQLite**: the
renderer runs a one-time, non-destructive import of the existing `localStorage`
records, and only once that import reports `completed` does it bind all four
repositories to the database through the preload bridge (see *Choosing the store
at startup*). A plain browser is untouched and keeps using `localStorage`. The
renderer's debounced drafts are coordinated through a save queue, and a graceful
shutdown handshake flushes them before the window is destroyed (see *Draft saves
and the close handshake*). An installer is built with `electron-builder` (see
*Packaging*); auto-update is not implemented.

## Choosing the store at startup

`src/data/desktopStorage.ts` runs once, before any collection is read, and
decides which store is authoritative:

- **No bridge** (a plain browser): the `localStorage` repositories stay bound and
  nothing else happens. Web-only development is unchanged.
- **Bridge present** (the desktop shell): the renderer runs the one-time import
  and, *only* when it reports `completed`, rebinds all four repository singletons
  to the SQLite adapters in `src/data/ipc/`.

The rule that shapes the failure handling is that there is no silent fallback. If
the database cannot be opened, or the import cannot complete, the repositories are
left exactly where they are and the gate shows a failure screen instead of
mounting the application (`src/Startup.tsx`, `src/components/startup/`). After the
import has completed, `localStorage` is no longer authoritative, so showing it
would present stale records as the user's workspace — which is exactly what the
failure screen avoids. The screen names the cause (database unavailable, an
unreadable collection, a conflict, a verification failure) and offers a retry; it
never presents an empty workspace.

## Process boundaries

```
┌──────────────────────────────────────────────────────────────────┐
│ main  (electron/main.ts → electron/dist/main.mjs, ES module)     │
│  • owns the BrowserWindow and the app lifecycle                  │
│  • owns the SQLite database (electron/db/**)                     │
│  • validates every IPC input                                     │
└───────────────▲──────────────────────────────┬───────────────────┘
                │ ipcMain.handle (named)       │ contextBridge (preload)
┌───────────────┴──────────────────────────────▼───────────────────┐
│ preload  (electron/preload.ts → electron/dist/preload.cjs, CJS)  │
│  • exposes window.x31deskDesktop — small, named, typed           │
│  • never exposes ipcRenderer or a generic invoke(channel, …)      │
└───────────────▲──────────────────────────────────────────────────┘
                │ window.x31deskDesktop (typed in src/types/desktop.ts)
┌───────────────┴──────────────────────────────────────────────────┐
│ renderer  (src/** — the existing React app)                      │
│  • picks the store: localStorage (web) or SQLite over IPC        │
│  • reads localStorage once at startup to seed the import         │
└──────────────────────────────────────────────────────────────────┘
```

| Process  | Source                  | Built to                        | Why                                                            |
| -------- | ----------------------- | ------------------------------- | -------------------------------------------------------------- |
| Main     | `electron/main.ts`      | `electron/dist/main.mjs`        | `package.json` is `"type": "module"`; Electron supports ESM.    |
| Preload  | `electron/preload.ts`   | `electron/dist/preload.cjs`     | Sandboxed preloads cannot be ESM and cannot import app source.  |
| Renderer | `src/**`                | `dist/**` (by Vite)             | The existing Vite/React application, used verbatim.             |

The sources are TypeScript; `electron/dist/` is generated, gitignored, and never
edited by hand.

### The build step (`scripts/build-electron.mjs`)

Electron loads JavaScript, and the sandboxed preload must be CommonJS, so both
entry points are bundled — with the Vite already in the project, so no tool is
added. Two separate bundles are needed because the two outputs use different
module formats:

- `electron/main.ts` → `electron/dist/main.mjs` (ES module),
- `electron/preload.ts` → `electron/dist/preload.cjs` (CommonJS).

`electron` and every `node:` built-in stay external (Electron provides them);
everything else is inlined. `npm run build:electron` runs it, and `npm run
build`, `npm start` and `npm run dev:electron` all run it first.

This is also what lets the **channel names be shared** instead of mirrored: both
bundles import `src/data/ipc/contract.ts` through the `@` alias. The contract is
string constants and types only — its record imports are `import type`, so it
inlines as plain constants and never pulls application code into the sandbox.

## Security posture

| Requirement                             | How it is met                                                                 |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| `contextIsolation: true`                | Set explicitly in `webPreferences`.                                            |
| `nodeIntegration: false`                | Set explicitly; the renderer has no `require`/`process`/`Buffer`.              |
| `sandbox: true`                         | Set explicitly; the renderer runs in Chromium's OS-level sandbox.              |
| No Node access from React               | The only bridge is `window.x31deskDesktop`; nothing else is added to `window`. |
| No unrestricted IPC                     | Named channels from the shared contract; no `invoke(channel, …)` is exposed.   |
| Input validation in main                | Each handler rejects any argument it is not defined to accept.                 |
| No SQL, paths or `ipcRenderer` to React | The database lives only in the main process; the renderer's reach is the bridge.|
| Restrictive CSP for the production page | Injected `<meta>` policy, strict in build, relaxed only for the dev server.    |
| Window lifecycle / shutdown             | Single-instance lock, `window-all-closed`, `activate`, `ready-to-show`.        |
| Graceful shutdown flush                 | Main holds the window on `close`, asks the renderer to flush, and waits (bounded) before destroying it. |
| Navigation containment                  | `setWindowOpenHandler` denies new windows; `will-navigate` blocks escapes (a same-URL reload of the current document, i.e. `F5`, is allowed). |

The CSP is injected by the `contentSecurityPolicy()` plugin in `vite.config.ts`
so it applies to the built page itself (and therefore to the Electron window).
Production ships `default-src 'self'` with `script-src 'self'` and
`connect-src 'self'`; `'unsafe-inline'` is allowed for styles only, because
CodeMirror injects its theme and measurement styles at runtime. The dev policy
additionally allows the HMR client's inline preamble and websocket.

## Running

```bash
npm run dev:electron   # bundles the shell, starts Vite + Electron, with HMR
npm run dev            # web only (unchanged)
npm run build          # typecheck + bundle the shell + production bundle
npm start              # bundle the shell, then open Electron on the built dist/
```

`npm run dev:electron` bundles the shell, then runs `scripts/dev-electron.mjs`,
which starts the Vite dev server through Vite's Node API, waits until it reports
a URL, and launches Electron with `X31DESK_DEV_SERVER_URL` set to it. Closing the
window closes the server; Ctrl+C closes both. Main-process changes need the
bundle rebuilt, which relaunching `dev:electron` does for you.

In production the main process loads `dist/index.html` with `loadFile`, i.e. over
`file://`. `base: './'` in `vite.config.ts` is what makes the relative asset URLs
resolve there, and `file://` is treated as a secure context by Chromium, so
`crypto.randomUUID` and `navigator.clipboard` keep working. `localStorage` under
`file://` is the same origin every time the app opens; on the desktop it is read
once, to seed the import, after which the repositories read SQLite. A browser
keeps using it as before.

## The database

`electron/db/` owns a SQLite database reached through Node's built-in
`node:sqlite` — the runtime Electron's bundled Node already ships — so it costs
no dependency and needs no native rebuild. Its API is synchronous, which makes
the main process a single writer: a mutation finishes before its handler
returns, so no two operations interleave.

- **Location.** `app.getPath('userData')/x31desk.db`. The path is never sent to
  the renderer.
- **Schema.** `electron/db/schema.ts` holds the forward-only migration chain.
  Version 1 is the approved initial schema: `notes`, `tasks`, `snippets`,
  `snippet_tags`, `archive` and `meta`. Version 2 adds `archive_corruption`, the
  write-once vault for an archive row the adapter cannot read back (see
  *Corruption safety*). Adding a table means appending a migration, never editing
  an earlier one.
- **Versioning.** `PRAGMA user_version` records the file's structure version
  (`CURRENT_DATABASE_VERSION`). Each migration runs inside
  `BEGIN IMMEDIATE … COMMIT`, and `user_version` advances only after that step's
  statements succeed; a failure rolls the whole step back, so a partial schema
  can never be left behind. A file from a *newer* build is refused rather than
  downgraded.
- **Durability.** `journal_mode = WAL`, `synchronous = FULL`, foreign keys on,
  and a busy timeout. `foreign_keys` is a connection setting; WAL is persistent.
- **Failure is explicit.** `initializeDatabase()` either returns a migrated
  handle or throws a `DatabaseInitError` with a code
  (`directory-unavailable`, `open-failed`, `migration-failed`, `newer-schema`)
  and an actionable message. It never returns a half-open connection, and the
  main process records the failure and logs it rather than claiming readiness.
  The renderer's startup gate turns that into the failure screen, so a database
  that could not be opened is reported rather than shown as an empty workspace.
- **Lifecycle.** Opened in `app.whenReady()` before the window is created, and
  closed on `will-quit` — which fires for every orderly quit path, and only after
  the close handshake has released the window — so the database stays open until
  the renderer has finished flushing.

### How the renderer reaches it

The renderer never touches the database directly. `electron/preload.ts` exposes a
narrow, typed bridge (`window.x31deskDesktop`) whose repository methods each
`invoke` exactly one channel from the shared contract
(`src/data/ipc/contract.ts`). The renderer-side adapters in `src/data/ipc/`
unwrap the `IpcResult` envelope into the renderer's own `StorageError`, so a
failure is indistinguishable from a local one to every caller. Which repositories
are actually bound to those adapters — and when — is decided at startup (see
*Choosing the store at startup*).

### The one-time import

At startup the renderer runs `runStorageMigration()` (`src/data/migration.ts`),
which moves the existing workspace into the database exactly once. It is a
conversation, because only the renderer can see `localStorage` and only the main
process can write the database:

1. **Detect.** In a plain browser there is no bridge, so the import is
   `not-started` and does nothing. Web-only development is unchanged.
2. **Inspect.** The renderer asks `x31desk:migration.status`; if the marker says
   the import already finished, it stops (idempotent).
3. **Read and validate.** `readMigrationSource()` reads the four collection keys
   and validates *every* record. A collection that is malformed — bad JSON, or an
   entry that fails its own guard — fails the read **as a whole** rather than
   dropping records, and its original bytes are preserved write-once under the
   collection's `:unreadable` key. A snapshot with a hole in it is never offered.
4. **Import.** `x31desk:migration.import` carries the snapshot to the main
   process, which re-validates it (IPC input is untrusted) and runs
   `importWorkspace()` (`electron/db/migration.ts`).
5. **Report.** The outcome advances the renderer's explicit state machine —
   `not-started` → `in-progress` → `completed` / `failed`. Only `completed` binds
   the SQLite repositories; every other outcome leaves the local stores in place
   and shows the failure screen instead of the application.

The import runs in **one transaction** and marks itself complete only after a
full-content verification:

- **All four collections together.** `notes`, `tasks`, `snippets` (with their
  ordered tags) and the archive commit as a unit. Any failure rolls the whole
  thing back, so the marker is never set on a partial import.
- **Nothing is overwritten.** A record already in the database is accepted only
  if its *canonical form* — a fixed-field serialization covering every persisted
  field, including snippet tag order and the archive payload
  (`electron/db/canonical.ts`) — matches exactly. A mismatch is a `conflict`: the
  import stops, reports the conflicting keys, and changes nothing. `INSERT OR
  IGNORE` is deliberately not used, because it would hide a conflict instead of
  surfacing it.
- **Verified, not counted.** After writing, the importer re-reads the database
  and compares full content, not row counts.
- **The marker is its own thing.** Success writes a row to `meta` under
  `migration:localStorage-import`, separate from `PRAGMA user_version` (the
  schema) and from the renderer's `x31desk:schema` marker. A retry after success
  finds the marker and does nothing.
- **Local data is safe.** The import never writes a collection key and never
  restores, rewrites or deletes a quarantine key; the only possible
  `localStorage` write is preserving bytes that could not be read, which is
  best effort and additive.

The IPC surface is typed exactly like the repository channels but, because a
conflict or an invalid source is a *decision the import reports* rather than a
transport failure, the two migration calls resolve with the contract's own result
type (`MigrationStatusResult`, `MigrationOutcome`) instead of an `IpcResult`
envelope. Only an unexpected database error is reduced to a `StorageErrorKind`
(`failed`), and no SQL, message or path is ever part of a response.

### Corruption safety (the archive vault)

The `localStorage` readers never destroy data they cannot understand. When a
collection payload is malformed, or contains an entry that fails its guard, the
reader copies the **original bytes** to a sibling `x31desk:*:unreadable` key
(`src/data/quarantine.ts`, write-once) before it leaves the bad entries out, so
the Settings page can still export what could not be read.

The SQLite archive adapter mirrors that guarantee. `archive.list()` is the one
operation that can meet a row it did not write, so when a row's `data` column is
not valid JSON — or is valid JSON that is not an `ArchivedItem` — the row is
copied verbatim into `archive_corruption`
(`electron/db/archiveQuarantine.ts`) and only then left out of the list:

- **Preserved exactly.** `data`, `type`, `record_id` and `archived_at` are stored
  as they were; the payload is never parsed or normalised, because a value that
  could not be understood is the wrong thing to run through a normaliser.
- **Write-once.** `INSERT OR IGNORE` keeps the first payload seen for a key, so a
  later corruption of the same record cannot replace it — the same write-once
  policy as `preserveUnreadable`.
- **The live row is untouched.** It stays in `archive`; nothing is moved, edited
  or deleted to make room for the copy, and nothing is auto-restored or imported.
- **Best effort.** If the vault cannot be written (say a read-only file), the
  failure is swallowed and the readable entries are still returned, so the
  archive always opens.
- **Removed only by an explicit reset.** `archive.clear()` — the user's "clear
  workspace data" — drops the vault alongside the rows, exactly as the
  `localStorage` adapter removes its quarantined key. That is the only operation
  that discards a preserved payload; an export never does.

A recovery surface reads it back verbatim through
`createArchiveQuarantine(database).list()`, exposed read-only over the
`x31desk:archive.corruption` channel. Nothing on that channel writes, moves or
deletes an entry. The Settings page reads the vault through it and folds the
entries into the same downloadable recovery document as the `localStorage`
quarantine (`src/data/recovery.ts`, `src/components/settings/UnreadableDataRow.tsx`),
so one export covers both stores and exporting can never disturb the data it
reports. When the vault cannot be read, the page says the archive could not be
checked rather than implying it is clean.

### Backup and restore

Three channels carry the whole-workspace backup: `x31desk:backup.export` (write a
file), `x31desk:backup.inspect` (read and validate one) and
`x31desk:backup.apply` (merge or replace). They are deliberately *stateless* —
`inspect` returns the validated document to the renderer, which hands it back to
`apply`, so the main process keeps no memory of which file was chosen — and their
outcomes are the contract's own result objects rather than an `IpcResult`, since
cancelling a dialog, refusing a file and writing one are all decisions the user
made. Only an unexpected I/O or database error is reduced to a `StorageErrorKind`.

`electron/db/backup.ts` owns the format (a versioned `.x31backup` JSON document),
the per-record validation (reusing `isNote`/`isTask`/`isSnippet`/`isArchivedItem`),
the merge/replace transactions and the export orchestration;
`electron/db/backupFiles.ts` is the only module that touches a real path, and both
the dialogs and the filesystem are injected so the handlers load under the plain
Node test runner. The whole-collection readers, writers, fold and post-write
verification are shared with the migration through `electron/db/workspaceIO.ts`,
which is why a merge can be verified canonically without a second implementation
of "what the workspace holds".

A merge inserts only records the workspace lacks and never overwrites a same-id
record with different content — it reports the clash instead; a replace clears the
four collections inside one transaction but deliberately leaves the `meta`
migration marker and the `archive_corruption` vault alone. Both verify the
destination after writing and roll back on any mismatch. The mode governs records
only: preferences are carried in the document and restored by either mode, since
the alternative is that the only way to recover a theme would be to delete the
workspace first. See the root README's *Backup and restore* for the file format
and the user-facing behaviour.

### Conformance with the `localStorage` adapters

The SQLite adapters are held to the same behaviour the `localStorage` adapters
have today; `tests/repositoryConformance.test.ts` runs one scenario against both
backends. The differences that exist are recorded here rather than papered over:

| Area            | `localStorage`                                        | SQLite                                                       | Status |
| --------------- | ----------------------------------------------------- | ------------------------------------------------------------ | ------ |
| `list()` order  | collection order (append on create, upsert in place)  | `rowid` order (append on create, upsert in place)             | equivalent |
| Archive order   | array order (a new entry is prepended)                | `archived_at DESC, rowid DESC`; a re-upsert reorders          | **differs** |
| `insert`        | upsert by `id` / `(type, record_id)`                  | upsert by the same key                                        | equivalent (intentional) |
| Missing record  | `update`/`setCompleted` resolve `null`                | resolve `null`                                                | equivalent |
| `remove`        | idempotent                                            | idempotent                                                    | equivalent |
| `clear`         | drops the collection **and** its quarantine key       | drops the rows **and** (archive) the corruption vault         | equivalent |
| Bad record read | filters it out and quarantines the collection         | notes/tasks/snippets read columns directly; archive preserves | **differs** |

The two genuine differences are deliberate and narrow:

- **Archive order.** The `localStorage` archive prepends on `add`, so it is
  ordered by *when an entry was added*; SQLite orders by `archived_at`. They
  agree while `archived_at` rises with insertion and the entry is never
  re-upserted. Ordering is a presentation concern — the UI sorts — so the
  conformance test only asserts the cases where both agree.
- **Bad-row handling for notes/tasks/snippets.** Those readers filter through
  `isNote`/`isTask`/`isSnippet` and quarantine the whole collection; the SQLite
  columnar reads instead trust the schema's `CHECK` constraints (a bad `priority`
  falls back to the default, and so on). This only differs for rows edited
  outside the application. The archive is the case that carries opaque JSON, so
  it is the one given the full vault; extending the same treatment to the other
  three is a later decision.

## Draft saves and the close handshake

Both workspaces write on a short debounce — a burst of keystrokes becomes one
write — and a naive `setTimeout` + `pendingRef` pattern loses edits once storage
is asynchronous: a write can still be in flight when the next keystroke arrives,
and a flush that merely clears a timer does not mean the write settled.

### The save queue (`src/data/saveQueue.ts`)

One queue coordinates every draft, keyed per record (`note:<id>`, `snippet:<id>`,
`snippet:new:<serial>`). It is framework-free — it knows an id and a function
that writes it — so it can be driven directly in a test.

- **Latest draft wins.** A newer `schedule` for the same id replaces an unstarted
  write, so only the newest content is written; a draft that arrives while a
  write is in flight runs immediately after it.
- **Awaitable flush.** `flush(id)` fires the debounce early and resolves once that
  write — and any newer draft scheduled during it — has settled; `flushAll()`
  resolves once every record has. Both reject if a write failed, so a caller can
  never mistake a failure for a success.
- **Cancel is not a race.** `cancel(id)`/`cancelAll()` drop an unstarted write (a
  write already in flight still finishes), which is what stops a debounced save
  from resurrecting a record that was just deleted or cleared.

The hooks (`useNotes`, `useSnippets`) schedule onto it instead of owning a timer.
Two consequences are worth naming:

- **Archive is not a delete.** `archiveSnippet` *flushes* (awaited, not merely
  started) and then re-reads the record from storage before archiving it, so the
  archived copy is the latest one. A delete *cancels* first, so nothing is
  written back.
- **A new snippet's first write cannot duplicate it.** A draft captured while a
  new snippet was still unsaved carries `id: null`; if a first write adopts an id
  before that draft runs, the queue resolves the id at execution time and updates
  rather than creating a second record.

`clearWorkspaceData()` (`src/data/workspaceReset.ts`) cancels every queued write
and awaits any that was in flight *before* it wipes, so the reset is the last
thing to touch storage.

### The close handshake

`beforeunload` is only a best-effort hint — Chromium does not wait for
asynchronous work in it, and a forced quit may not fire it at all — so durability
on the desktop is an explicit conversation:

1. On the window's `close`, main calls `event.preventDefault()` and sends
   `x31desk:lifecycle.flush-request` instead of letting the window go.
2. The renderer's half (`src/data/closeHandshake.ts`, installed once from
   `src/main.tsx`) runs `flushAll()` on the shared queue and waits for every
   pending and in-flight write to settle. Concurrent requests share one flush.
3. It answers `x31desk:lifecycle.flush-result` with `{ ok }` — `true` only if
   everything settled, `false` if a write failed. Main destroys the window on
   either answer, but it is never told a write succeeded that did not.

The main-process half (`electron/lifecycle/closeHandshake.ts`) is a small state
machine over injected side effects and timers:

- **`terminate` runs exactly once**, from any terminal path — an answer, the
  timeout, or the renderer vanishing.
- **Repeated requests are idempotent.** A second `close` while a flush is in
  flight does not start a second one; a `close` after the handshake settled is
  released.
- **A timeout or a crash is not a success.** After `DEFAULT_FLUSH_TIMEOUT_MS`
  (5 s), or immediately on `render-process-gone`, main stops waiting and closes
  anyway — logging that data may not have been persisted rather than claiming it
  was. An answer that is missing or malformed is treated as `{ ok: false }`.
- **The database stays open across it.** The window is destroyed by the handshake
  and the database is closed on `will-quit`, which fires only after the window is
  gone, so a flush can never race a closed connection.

`beforeunload` is still installed in both workspaces, but only as the best-effort
path for the plain browser, where there is no bridge and the handshake is a
no-op.

## Native window chrome (the title bar)

Windows draws the standard caption — the title bar and its minimize/maximize/close
buttons — with the Desktop Window Manager, not the renderer, so no CSS in the page
can colour it. Two facts follow, and the implementation is built directly on them:

- **`nativeTheme.themeSource` is the supported control.** Chromium applies
  `DWMWA_USE_IMMERSIVE_DARK_MODE` to each window from it
  (`shell/browser/win/dark_mode.cc`), so `light` and `dark` pin the caption to that
  appearance and `system` hands the decision back to the OS. Chromium also forces a
  caption repaint when the value changes — it toggles `WM_NCACTIVATE` inside
  `TrySetWindowTheme` — which is why changing the theme in Settings recolours the bar
  immediately rather than on the next focus change.
- **An arbitrary caption colour is not available on the standard frame.** An
  arbitrary colour is what `BrowserWindow.setTitleBarOverlay` (the Windows control
  overlay) gives, but it requires `titleBarStyle: 'hidden'`, which replaces the
  title bar with page content. Since the native title bar is deliberately kept, the
  choice is the OS's light or dark caption rendering, not the exact Nordic Blue
  canvas value.

`themeSource` is application-wide, so the renderer's `prefers-color-scheme` follows it
too. The application therefore sends its **preference**, never the resolved theme:

| Preference | `nativeTheme.themeSource` | Result                                                       |
| ---------- | ------------------------- | ------------------------------------------------------------ |
| `light`    | `light`                   | light caption, even when Windows is in dark mode              |
| `dark`     | `dark`                    | dark caption, even when Windows is in light mode              |
| `system`   | `system`                  | caption follows Windows, exactly as the application does      |

Sending the resolved theme would pin `themeSource` while the preference was `system`,
so the operating system could never change the appearance again — which is why the
preference is the only value that can travel.

The flow is one direction, starting in `src/main.tsx`:

1. `installNativeThemeSource()` (`src/data/nativeThemeSource.ts`) reads
   `settingsStore` synchronously, before the first render — so the persisted choice
   is applied as soon as the window appears — and subscribes for later changes. An
   emit that does not move the preference (an editor tweak) is not re-sent.
2. `x31desk:theme.set-source` carries `{ preference }` through the preload bridge
   (`theme.setSource`). It is a `SHELL_CHANNELS` member, because it is not a
   repository operation.
3. `electron/ipc/themeHandlers.ts` validates the payload with the application's own
   `isThemePreference` guard (`parseThemeSource`) and assigns
   `nativeTheme.themeSource`. A rejected argument leaves the caption exactly as it
   was, reported in the usual `IpcResult` envelope rather than applied.

In a plain browser there is no bridge, so installation is a no-op and the web build is
unchanged. The window's `backgroundColor` stays the light canvas: it is visible only
for the moment before the first paint, because the window stays hidden until
`ready-to-show`.

### Verified

Checked on Windows 11 (build 26300) with the desktop in **dark** app mode, so every
light reading below is the application's choice over the operating system's. The
built shell was launched with a throwaway `--user-data-dir`, the theme was driven
through the top-bar toggle (the same `settingsStore` the Settings page writes to) and
through the bridge directly, and the live caption was sampled off the screen:

| Step                                 | Caption pixel | Read as          |
| ------------------------------------ | ------------- | ---------------- |
| startup, persisted `light`           | `243,243,243` | light            |
| toggle → `dark` (live)               | `32,32,32`    | dark             |
| toggle → `light` (live)              | `243,243,243` | light            |
| `system` (Windows dark)              | `32,32,32`    | dark             |
| explicit `light` over the dark OS    | `243,243,243` | light            |
| rejected `midnight` preference       | `243,243,243` | light (untouched)|
| restart with persisted `light`       | `243,243,243` | light            |

The two runs also exited through the close handshake and logged `renderer flushed;
closing` and `database closed`, so the theme work did not disturb shutdown.

## Extending the bridge

To add a capability, follow the existing shape — do not widen the preload to a
generic invoker:

1. Add a channel name and its request/response shape to `src/data/ipc/contract.ts`.
2. Register its `ipcMain.handle` in `electron/main.ts` with explicit input
   validation, returning a value for an infallible read or an `IpcResult` for a
   fallible one.
3. Add the matching method to the `bridge` object in `electron/preload.ts`.
4. Add the method's type to `DesktopBridge` in `src/types/desktop.ts` and handle
   the bridge being absent (the app also runs in a plain browser).

## Persistence: what exists now, and what remains

The repositories in `src/data/*Repository.ts` are asynchronous and
interface-shaped exactly so a SQLite-backed adapter can replace the single
binding each file exports (`noteRepository`, `taskRepository`, …). The shared
interfaces live in `src/data/repositoryTypes.ts`, apart from the `localStorage`
implementations, because the main process needs the same contracts without
pulling `window` into its build.

**Implemented.**

- `electron/db/repositories/*.ts` implement the four repository interfaces
  against `DatabaseSync`, using prepared statements and transactions
  (`electron/db/transaction.ts`). Insert is an upsert; a snippet's tags and an
  archive entry are keyed the same way the `localStorage` adapters key them.
- An archive row the adapter cannot read back is preserved verbatim in
  `archive_corruption` before it is left out of `list()`
  (`electron/db/archiveQuarantine.ts`), so a skip is never silent; see
  *Corruption safety* below.
- `electron/ipc/repositoryHandlers.ts` registers one `ipcMain.handle` per data
  channel in the contract. Each handler validates its payload
  (`electron/ipc/validation.ts`, reusing the application's own record guards),
  runs one operation, and reduces the outcome to an `IpcResult`. A failure is
  classified by `electron/db/errorKind.ts` — `quota` for a full database,
  `unavailable` for a read-only/unreachable one, otherwise `unknown` — and the
  raw message, SQL and path never cross the boundary. When the database is not
  open, every operation answers `unavailable` rather than throwing.
- `electron/preload.ts` publishes the four repository groups (`notes`, `tasks`,
  `snippets`, `archive`), the read-only `recovery` group (the archive corruption
  vault), the `migration` group, the `backup` group (export/inspect/apply), the
  `lifecycle` group (the close handshake — a push/answer pair rather than
  request/response) and the `theme` group (the native title bar, one setter), as
  named methods returning the plain `IpcResult` envelope (or, for migration,
  backup and lifecycle, their own result types), typed by `DesktopNoteBridge` (and
  the rest) in `src/types/desktop.ts`.
- `src/data/ipc/*.ts` adapt those envelopes back into the four repository
  interfaces, recreating a renderer-side `StorageError` from a failure envelope
  so existing error handling is unchanged.
- `electron/db/migration.ts`, `electron/db/canonical.ts` and
  `electron/ipc/migrationHandlers.ts` implement the one-time import;
  `src/data/migration.ts` holds the renderer's strict source reader and state
  machine. See *The one-time import*.
- **The switch-over.** `src/data/desktopStorage.ts` runs at startup, imports the
  workspace once, and rebinds all four repository singletons to the IPC adapters
  only once the import reports `completed`. The four repository modules keep the
  `localStorage` factory as their default, so a plain browser is unchanged; the
  desktop shell swaps the binding through swappable singletons
  (`bind*Repository` / `reset*Repository`). A failure to open the database, or an
  import that cannot complete, is shown as the failure screen
  (`src/Startup.tsx`) rather than mounting the application against stale
  `localStorage` data.
- **Recovery.** The archive corruption vault is read over the read-only
  `x31desk:archive.corruption` channel (`electron/ipc/recoveryHandlers.ts`,
  `src/data/recovery.ts`) and folded into the Settings recovery export alongside
  the `localStorage` quarantine.
- **Backup and restore.** `electron/db/backup.ts` (format, validation, merge,
  replace, export), `electron/db/backupFiles.ts` (the `node:fs` port) and
  `electron/ipc/backupHandlers.ts` (the three channels) write and read a whole
  workspace as one `.x31backup` file; `src/data/backup.ts` and
  `src/components/settings/BackupData.tsx` are the renderer's half. See *Backup
  and restore* under *The database*.

**Not implemented yet.**

1. Auto-update: a build has to be distributed by hand; there is no update channel.

## Packaging

```bash
npm run dist:win     # build both halves, then produce release/x31Desk Setup 0.1.0.exe
npm run test:e2e     # probe the built app end to end against a throwaway profile
```

`electron-builder.yml` is the config. The package is deliberately tiny: only
`dist/` (the Vite renderer), `electron/dist/` (the bundled shell), and
`package.json`. `node_modules` is excluded — the main process imports only
`electron` and `node:` builtins, and the renderer is already bundled by Vite — so
`app.asar` is about 1.5 MB. The installer is about 106 MB, nearly all of which is
the Electron runtime itself.

- **Target.** `nsis` for x64, non-one-click, so the install directory is
  selectable.
- **Paths.** Nothing needed changing: the main process resolves its preload and
  `dist/index.html` from `app.getAppPath()`, which returns the asar path once
  packaged, and the database lives in `app.getPath('userData')` — outside the
  archive.
- **Icon.** `build/icon.ico` is generated from the official logo by
  `scripts/make-icon.ps1`: the symbol is cropped from `transparent.png` (the
  wordmark is excluded) and centred on a transparent square, keeping the
  artwork's own colors and alpha. The `.ico` carries 16, 24, 32, 48, 64, 128 and
  256 px entries, each 32 bpp with an AND mask derived from the same alpha, so a
  consumer that falls back to the mask cuts out the same shape. electron-builder
  stamps it on the executable and the installer
  (`win.icon`, `nsis.installerIcon`/`uninstallerIcon`/`installerHeaderIcon`), and
  `extraResources` copies it beside the archive so `electron/main.ts` can set the
  same icon on the window (`resolveAppIcon`). The in-app branding is described
  under "The logo" below.
- **Uninstall keeps the data.** `deleteAppDataOnUninstall` is `false`, because the
  workspace is SQLite in the user's application-data directory. Removing the app
  must not silently remove the user's notes.

**Verified.** The installer has been built and opened: it was run silently into a
temporary directory, and the installed application was then probed end to end.
All 19 checks pass, covering the preload bridge, SQLite reads and writes, a
record surviving a restart, a corrupt archive row being skipped and preserved,
the read-only recovery channel, the close handshake flushing before the database
closes, and Settings reporting the SQLite backend. The custom icon was confirmed
by extracting it back out of both `x31Desk.exe` and the installer.

## The logo

The artwork the application ships is `transparent.png` at the repository root —
500x500, an alpha channel, the symbol above the "x31Desk" wordmark on a
transparent background. Everything else is *derived* from it by scanning the
original pixels; nothing is redrawn, recoloured or re-lettered, and the wordmark
is never rebuilt as text. Both generators are run by hand when the logo changes,
not as part of the build. The supplied `x31Desk Gradient App Logo.png` (1254x1254,
the same lockup on a white background) stays at the root as the original artwork,
but nothing is derived from it: it has no alpha channel, so it could not produce
an asset that sits on the page's own background.

- `scripts/make-icon.ps1` builds the Windows icon (`build/icon.ico`,
  `build/icon.png`) from the **symbol alone**, centred on a transparent square.
- `scripts/make-logo-assets.ps1` builds the two in-app assets, both square so a
  caller can size them by edge length:
  - `src/assets/x31desk-logo.png` — the full lockup (symbol + wordmark), trimmed
    of the source's transparent margin.
  - `src/assets/x31desk-mark.png` — the symbol alone, in the same framing as the
    app icon.

Both keep the artwork's own alpha, so on a dark theme the logo sits on the
surface behind it instead of on a white box.

`src/components/branding/BrandMark.tsx` is the one component that renders them.
`variant="full"` is used wherever the wordmark has room to read — the startup
splash, the storage-failure screen and the Settings About panel — and
`variant="mark"` in compact chrome, the sidebar's 48px header row, where the
wordmark would be illegible. The favicon is the same bundled mark: `index.html`
points `<link rel="icon">` straight at it, so no second copy exists. Every image
carries `alt="x31Desk"`.
