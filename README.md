# x31Desk

A premium personal desktop workspace for notes, tasks and focused work.

The project contains the **application shell** — sidebar navigation, a compact top
bar and a themed content area — a **home dashboard** that summarises the
workspace, three working areas persisted locally on the device — a **notes
workspace** (searchable list, in-place editor with debounced autosave, deletion
behind a confirmation), a **tasks workspace** (filter tabs and search, a form
dialog, priorities and due dates, completion) and a **snippets workspace**
(searchable, filterable code snippets with autosave and copy-to-clipboard) — and
an **archive** that gathers everything set aside from those three workspaces into
one searchable list, from which it can be restored or permanently deleted — plus a
**settings workspace** covering appearance (light / dark / system),
code-editor preferences, local data management and product
information. A **workspace search**
in the top bar (`Ctrl+K`) looks across notes, tasks, snippets and the archive at
once and jumps straight to what it finds. A minimal **Electron shell** now runs
the same application as a Windows desktop app and opens a versioned SQLite
database in its main process; the repositories are not yet moved onto it, and
installers come later.

## Stack

| Concern          | Choice                                                           |
| ---------------- | ---------------------------------------------------------------- |
| UI               | React 19 + TypeScript                                            |
| Build tool       | Vite 8                                                           |
| Styling          | Tailwind CSS 4 (CSS-first config, `@tailwindcss/vite` plugin)     |
| Code editor      | CodeMirror 6 (snippets workspace)                                 |
| Icons            | lucide-react                                                     |
| Fonts            | Inter + JetBrains Mono, self-hosted via `@fontsource-variable/*` |
| Desktop shell    | Electron 44 (main + sandboxed preload in `electron/`)            |
| Desktop database | SQLite via Node's built-in `node:sqlite` (main process only)     |
| Lint / typecheck | oxlint, `tsc -b`                                                 |
| Package manager  | npm                                                              |

## Commands

```bash
npm install         # install dependencies
npm run dev         # start the dev server (http://localhost:5173)
npm run dev:electron # bundle the shell, then Vite + Electron window, with HMR
npm run build       # typecheck + bundle the shell + production build into dist/
npm run build:electron # bundle the Electron main process and preload only
npm start           # bundle the shell, then load the built dist/ in Electron
npm run preview     # serve the production build locally
npm run typecheck   # TypeScript only
npm run lint        # oxlint
npm test            # storage safeguards, IPC contract and database init
```

## Project structure

```
electron/            Desktop shell: the main process (window, lifecycle, IPC
                     seam, SQLite database in db/), the sandboxed preload
                     bridge, and its own README; written in TypeScript and
                     bundled to electron/dist/ (gitignored)
scripts/             dev-electron.mjs — the Vite + Electron development launcher
                     build-electron.mjs — bundles main + preload with Vite
src/
├─ assets/            Static artwork (official logo: full lockup and symbol)
├─ components/
│  ├─ archive/        Archive workspace: ArchiveList, ArchiveListItem,
│  │                  ArchiveFilters, ArchiveTypeBadge
│  ├─ branding/       Brand identity: logo lockup
│  ├─ dashboard/      Home dashboard blocks: StatCard, DashboardSection,
│  │                  QuickAction, TodayFocus
│  ├─ layout/         Shell chrome: Sidebar, TopBar, NavItem
│  ├─ notes/          Notes workspace: NotesList, NoteListItem, NoteEditor
│  ├─ search/         Workspace search: WorkspaceSearch, SearchResultsList
│  ├─ settings/       Settings workspace: SettingsSection, SettingsNav,
│  │                  ToggleRow, FieldRow, UnreadableDataRow
│  ├─ snippets/       Snippets workspace: SnippetList, SnippetListItem,
│  │                  SnippetEditor, CodeEditor, CopyButton,
│  │                  SnippetLanguageBadge, codeLanguage, codeEditing
│  ├─ tasks/          Tasks workspace: TaskFilters, TaskList, TaskListItem,
│  │                  TaskDialog, TaskCheckbox, TaskDueBadge, TaskPriorityBadge
│  └─ ui/             Reusable primitives: Button, IconButton, Select, ThemeToggle,
│                     PageHeader, EmptyState, Surface, SegmentedControl,
│                     ConfirmDialog, ToastProvider
├─ data/              Persistence: the notes, tasks and snippets repositories
│                     (each swappable for SQLite), the shared task store, the
│                     archive repository plus the store that coordinates it, the
│                     settings store, the workspace-reset coordinator, the
│                     workspace schema version and its migrations, the canonical
│                     storage-key registry, the cross-tab change watcher, the
│                     stable-read guard that keeps a pending load from
│                     overwriting a newer change, storage-failure classification
│                     and its user-facing wording, and quarantine recovery for
│                     unreadable payloads
├─ hooks/             useSettings, useEditorPreferences, useTheme, useToday,
│                     useToast, useKeyboardShortcut, useCopyToClipboard,
│                     useNotes, useNoteCount, useTasks, useSnippets, useArchive,
│                     useWorkspaceSearch
├─ layouts/           AppShell — sidebar + top bar + content column
├─ navigation/        Navigation model (entries), view → page registry, one-shot intents
├─ pages/             HomePage, NotesPage, TasksPage, SnippetsPage, ArchivePage,
│                     SettingsPage
├─ styles/
│  ├─ globals.css     Entry point: Tailwind, tokens, base styles
│  ├─ tokens.css      Design tokens (colors, type, radii, elevation, metrics)
│  └─ theme.css       Maps tokens onto Tailwind utilities
├─ types/             Shared TypeScript types (note, task, snippet, archive,
│                     navigation, theme and editor preferences, search,
│                     the Electron desktop bridge)
└─ utils/             Framework-agnostic helpers (cn, date, id, text, task,
                      snippet, archive, clipboard, search, download)
```

Imports use the `@/` alias for `src/`, configured in both `vite.config.ts` and
`tsconfig.app.json`.

## Design foundation

`src/styles/tokens.css` is the single source of truth for the visual language.
Tokens are plain CSS custom properties, which lets components, Tailwind
utilities and (later) native window chrome read the same values.

Nordic Blue light theme (the default):

| Token                    | Value     | Usage                  |
| ------------------------ | --------- | ---------------------- |
| `--x31-color-canvas`     | `#F2F6FA` | Application background |
| `--x31-color-sidebar`    | `#E7EDF4` | Sidebar / navigation   |
| `--x31-color-surface`    | `#FFFFFF` | Cards, top bar, panels |
| `--x31-color-text`       | `#202E40` | Primary text           |
| `--x31-color-text-muted` | `#718096` | Secondary text         |
| `--x31-color-accent`     | `#3978B8` | Accent blue            |
| `--x31-color-border`     | `#D9E2EC` | Borders and dividers   |
| `--x31-color-danger`     | `#C04A44` | Destructive actions    |

A coordinated dark theme lives under `[data-theme='dark']`. `src/styles/theme.css`
exposes everything as semantic Tailwind utilities, so components never hardcode
a colour: `bg-canvas`, `bg-sidebar`, `bg-surface`, `bg-nav-hover`, `text-ink`,
`text-ink-muted`, `border-line`, `bg-accent`, `bg-accent-soft`, `text-on-accent`,
`bg-danger`, `text-danger`, `text-warning`, `bg-warning-soft`, `bg-scrim`,
`shadow-card`, `font-mono`, `text-2xs`, `w-sidebar`, `h-topbar`.

Destructive actions use a `danger` family that mirrors the accent family
(`danger`, `danger-strong`, `danger-soft`, `on-danger`), transient states use a
`warning` family (`warning`, `warning-soft`), and `scrim` backs modal dialogs — so
delete confirmations and "unsaved" notices are themed rather than hardcoding a red
or an amber.

## Application shell

```
┌──────────────┬────────────────────────────────────────┐
│ x31Desk      │ Workspace / Home      ⌘ Search  ☾  ⚙  │  ← TopBar (48px)
├──────────────┼────────────────────────────────────────┤
│ Workspace    │ YOUR WORKSPACE        Wed, Oct 14      │
│  Home        │ Good morning.       New note  New task │
│  Notes       │ A clear space to focus on what…        │
│  Tasks       │ ┌────────┐ ┌────────┐ ┌────────┐       │
│  Snippets    │ │Notes 0 │ │Due   0 │ │Done  0 │       │
│  Archive     │ └────────┘ └────────┘ └────────┘       │
│              │ ┌──────────────┐ ┌──────────────┐      │
│              │ │ Recent       │ │ Today's      │      │
│              │ │  empty state │ │  empty state │      │
│              │ └──────────────┘ └──────────────┘      │
│  Settings    │ ┌────────────────────────────┐         │
│  Local ws.   │ │ Quick actions              │         │  ← scrollable
│              │ └────────────────────────────┘         │
└──────────────┴────────────────────────────────────────┘
```

The notes workspace replaces the content column with two panes that scroll
independently, so the page itself never scrolls at 1366×768:

```
┌──────────────┬────────────────────────────────────────┐
│ x31Desk      │ Workspace / Notes    ⌘ Search  ☾  ⚙   │  ← TopBar (48px)
├──────────────┼────────────────────────────────────────┤
│ Workspace    │ Notes                  [ ✎ New note ]  │
│  Home        │ Long-form notes and quick captures…    │
│  Notes ◂     │ ┌─────────────┬──────────────────────┐ │
│  Tasks       │ │ 2 notes     │ Untitled note        │ │
│  Snippets    │ │ [ Search… ] │ Created … · Updated… │ │
│  Archive     │ │─────────────│          Saving  ✕   │ │
│              │ │ Untitled…   │                      │ │
│              │ │ Release c…  │ (body, scrolls here) │ │
│              │ │ Oct 14      │                      │ │
│  Settings    │ └─────────────┴──────────────────────┘ │
└──────────────┴────────────────────────────────────────┘
```

Tasks and snippets reuse the same master–detail content column — tasks as a list
beside a form dialog, snippets as a list beside an in-place editor — so the
diagram above stands in for all three workspaces.

**Navigation** is state-based, not routed. `App` owns the active `ViewId`;
`src/navigation/navigation.ts` holds the sidebar entries (id, label, icon) and
`src/navigation/viewRegistry.ts` maps each id to its page component as an
exhaustive `Record<ViewId, ComponentType<PageProps>>`, so adding a view without a
page is a compile error. Every page receives `onNavigate`, which is how the
dashboard links into Notes, Tasks and Snippets. The shell never unmounts while
navigating — only the component in the content column is swapped.

**Theme** is applied to `<html data-theme="…">` by the shared settings store
(`src/data/settingsStore.ts`), which persists the preference — `light`, `dark` or
`system` — in `localStorage` under `x31desk:theme`. `light` is the default;
`system` follows the OS `prefers-color-scheme` live, and the top-bar toggle and
the Settings page read the same store, so they can never disagree.

**Cross-view actions** — the dashboard's **New note** and **New task** buttons (and
the matching quick actions) record a one-shot intent (`src/navigation/intent.ts`)
and navigate to the workspace that owns creation, which claims the intent and opens
its form: a shortcut labelled "New note" produces a note rather than opening a page.
The shell's `Ctrl+N` shortcut takes the same route but aims it at the section you
are in — on **Tasks** it records `create-task` and opens the task form, on
**Snippets** `create-snippet`, and from a section with no form of its own (Home,
Archive, Settings) it falls back to a note in **Notes** — so a global key and a page
button cannot drift apart. The same one-shot intents carry a search selection into the
workspace it belongs
to — a note, a task, a snippet or an item in the archive (see
[Workspace search](#workspace-search)); a workspace that is already open receives it
on the spot rather than being left for a later visit. No fake data or stub records
exist anywhere.

The dashboard reads every count from the store that owns it: notes via
`useNoteCount`, and today's and completed task counts from the shared task store
(`useTasks`), so ticking a task off on the dashboard updates the overview on the
same frame.

## Keyboard shortcuts

Every shortcut lives in one registry — `src/shortcuts/shortcuts.ts` — which is both
the table the shell dispatches against and the list Settings renders, so the
documented binding and the firing binding are the same object.
`useShellShortcuts` (`src/hooks/useShellShortcuts.ts`) is the single window
listener behind every `shell`-owned key; `Ctrl+K` and `/` stay with the search
field, `Ctrl+Shift+C` with the snippets page, and `Esc` with the dialogs and
toasts that close, so no keystroke ever has two handlers.

| Keys                     | Action                                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `Ctrl+1` … `Ctrl+6`      | Go to Home, Notes, Tasks, Snippets, Archive, Settings — sidebar order                                            |
| `Ctrl+K` or `/`          | Focus workspace search (`/` stands down while you are typing)                                                    |
| `Ctrl+N`                 | New note, task or snippet for the current section (a note in sections without a form)                             |
| `Ctrl+S`                 | Flush pending debounced saves now — autosave keeps running untouched, silent when nothing is pending               |
| `F2`                     | Focus the open item's title so it can be renamed (Notes and Snippets editors)                                     |
| `F5`                     | Drain the save queue, then reload the workspace                                                                    |
| `Ctrl+Shift+C`           | Copy the open snippet's code (while the editor is open)                                                           |
| `Esc`                    | Close the dialog (native `<dialog>`), sweep toasts, dismiss dropdowns and the search list                          |

Two rules keep the shortcuts out of the way: every shell binding is a modifier
combination or a function key, so it can fire from inside a field or CodeMirror
without eating a character the user meant to type; and a modal dialog stands
navigation, creation and rename down, so the form in front of you is never
discarded by a keystroke aimed elsewhere. Plain editing keys — copy, paste, cut,
undo, redo, select-all, find — are never claimed by the registry. Browsers may
reserve `Ctrl+1`…`Ctrl+6` (tab switching) and `Ctrl+N` (new window) for
themselves; the desktop app receives all of them.

The full list is in **Settings → Keyboard Shortcuts**, rendered from the same
registry, and `tests/shortcuts.test.ts` pins the mappings, the conflict rules and
the dispatch.

## Workspace search

`src/components/search/` is the field in the top bar and the dropdown it opens.
It is a shell-level feature on purpose: it must reach every workspace while the
top bar stays mounted, and it must not depend on whichever page happens to be
open.

| Layer          | File                                    | Responsibility                                        |
| -------------- | --------------------------------------- | ----------------------------------------------------- |
| Field          | `src/components/search/WorkspaceSearch.tsx` | Input, keyboard, open/close, intent dispatch       |
| Results        | `src/components/search/SearchResultsList.tsx` | Grouped rows, hint and empty states             |
| State          | `src/hooks/useWorkspaceSearch.ts`       | Reads the four repositories, exposes `refresh`         |
| Matching       | `src/utils/search.ts`                   | `buildSearchResults`, the matchers and the ranking      |
| Types          | `src/types/search.ts`                   | `SearchResult`, `SearchGroup`, `WorkspaceDocuments`     |

**One source of truth.** The field reads the *repositories* rather than through a
page: the top bar outlives every page, so it cannot borrow a workspace's in-memory
list, and a workspace that has never been opened has no list to borrow. The hook
loads all four collections once and re-reads them when the field regains focus
(`refresh`), so a result never describes a version of a record that has since
changed.

**What matches.** A hit is anything whose text contains every word of the query:

| Kind    | Searched text                                                       |
| ------- | ------------------------------------------------------------------- |
| Note    | title + content                                                      |
| Task    | title + description                                                  |
| Snippet | title + code + language label + tags                                 |
| Archive | an archived record's title and its body (note body, task description, snippet code) |

**Ranking and grouping.** Results are grouped by kind — Notes, Tasks, Snippets and
Archive — in that order. Within a group a **title** hit always outranks a body-only
hit, and ties keep the newest first, so the thing you named is the thing you see.
Each group shows at most five rows; the rest collapse into a single "N more
matches" line. The flat order the groups render is the order the arrow keys walk,
so the keyboard and the pointer always agree.

**Following a result** goes through the same one-shot intents the dashboard uses
(`src/types/navigation.ts`). A page claims an intent as it mounts, and also
subscribes for one that arrives while it is already open (`useViewIntent`), so a
selection always opens its item — including when you are already looking at the
workspace the item lives in:

| Clicking a result | What happens                                                             |
| ----------------- | ------------------------------------------------------------------------ |
| Note              | Notes opens with that note selected                                       |
| Task              | Tasks opens with the task's edit dialog already open                      |
| Snippet           | Snippets opens with that snippet in the editor                            |
| Archived item     | Archive opens with its search prefilled to the item's title, revealing it |

Archived results are shown in their own **Archive** group rather than mixed into
the live groups: an archived record no longer exists in its home workspace, so
showing it under "Notes" beside active notes would be the lie.

**Keyboard and states.** `Ctrl+K` focuses the field from anywhere, and `/` does the
same from anywhere you are not already typing into a field (so a slash typed into a
note or snippet reaches the text, not the shortcut). `↓` / `↑` move
the highlight, `Enter` follows the highlighted result, `Escape` closes the
dropdown (and clears the highlight), and clicking anywhere outside dismisses it.
Focusing the field with an empty query explains what is searched; a query with no
matches says so plainly instead of showing an empty box. Results update on every
keystroke — no submit button — and each workspace keeps its own search and filter,
so the global field never disturbs the list you are working in.

## Dropdowns

Native `<select>` elements are not used anywhere in the app. Their popup is drawn
by the browser and cannot follow the Nordic Blue palette in both themes, so a
native control would be the one surface that ignores the design tokens.

`src/components/ui/Select.tsx` is the replacement, used by the Settings
**Editor font size** control, the snippet editor's **Language** picker and the
snippets list's **Filter by language** menu. It keeps the same props API as the
old primitive, so callers did not change.

- The **trigger** is a `button[role="combobox"]` styled exactly like a text field —
  same height, border, radius, surface and focus treatment. The value carries
  `aria-labelledby` to a label span, so the control is named for assistive tech
  whether or not the label is drawn on screen.
- The **menu** is a `ul[role="listbox"]` rendered in a `createPortal` to
  `document.body` with `position: fixed`. Portalling is what stops it being clipped
  by a scrolling pane or a card's `overflow`, and the component measures the
  trigger and flips the menu upward when there is not enough room below. It
  repositions on scroll and resize while open.
- Options use the shared floating-panel chrome — surface background, `border-line`,
  `rounded-md`, `shadow-floating`, tight padding — with the accent-soft wash on the
  hovered/active row and the accent tint plus a check on the selected one.
- **Keyboard** follows the ARIA select-only combobox pattern: focus stays on the
  trigger, the highlighted row is announced through `aria-activedescendant`, and
  `↑` / `↓` / `Home` / `End` / `Enter` / `Space` / `Escape` / `Tab` behave as
  expected. A pointer click outside closes it.

The one native control that remains is the task dialog's `<input type="date">`:
that opens the platform's date picker, which is not a dropdown and is the right
control for choosing a calendar day.

## Home dashboard

`src/pages/HomePage.tsx` composes the dashboard from small, focused blocks in
`src/components/dashboard/`:

| Block              | Responsibility                                                      |
| ------------------ | ------------------------------------------------------------------- |
| `StatCard`         | One overview count (notes, tasks due today, completed tasks).        |
| `DashboardSection` | Card chrome plus the `h2` heading shared by every dashboard block.   |
| `QuickAction`      | Compact action pill with a soft accent wash on hover.                |
| `TodayFocus`       | Today's (and overdue) tasks with inline checkboxes, capped at five.  |

The greeting and date come from `useToday`, which re-checks once a minute so a
desktop window left open across a day boundary stays correct. Every count is read
from the store that owns it rather than being placeholder data: notes come from
`useNoteCount` and tasks from the shared `useTasks` store.

**Today's focus** lists today's tasks plus anything overdue — a task that slipped
past midnight is exactly what today's list is for — capped at five with an overflow
count. The **Tasks due today** stat above stays literal (`dueDate === today`),
because that is what its label promises. Tasks are ticked off inline, and the
change lands in the same store the tasks workspace reads.

`EmptyState` has two variants: `panel` (used for the page-level empty states —
notes, tasks, snippets and the placeholders — and draws its own dashed surface) and
`inline` (used inside dashboard cards and list panes, adds no second border, fills
its container).

## Storage

The four collections (notes, tasks, snippets and archive) share two pieces of
infrastructure that keep them safe to move onto a slower, asynchronous backend
later. Neither changes what is stored or how it is read today.

**Schema versioning.** `src/data/schema.ts` records a single version under
`x31desk:schema`. `ensureWorkspaceSchema()` runs once at startup, before any
collection is read. A workspace written before versioning existed simply has no
marker; that is treated as version 0 — a legitimate older version, never corrupt
data — and brought forward the same way any older version is. The only step
defined so far adopts versioning: version 0 and version 1 use the same keys and
record shapes, so it records the marker and rewrites nothing. A marker at or
above the current version is left untouched, so a workspace written by a newer
build is never downgraded. Future migrations are appended to
`WORKSPACE_MIGRATIONS` in ascending order, and are only described here once they
are actually implemented.

**Load precedence.** `src/data/readStable.ts` guards every bulk read. Each store
keeps a revision counter that a mutation bumps once its write has completed; a
read is applied only when the counter is unchanged across it, otherwise the read
is stale and is retried. A note created, a task deleted or an archive move made
before the first load resolves can therefore never be overwritten by that load.
The result is applied through a callback so the change-detection check and the
apply happen in the same tick — returning a value would leave a gap for a
mutation to slip into. localStorage resolves within that tick, so nothing changes
today; the guard is what keeps the same code correct once reads become
asynchronous.

**Cross-tab synchronization.** The same workspace can be open in several tabs at
once, and they share one `localStorage`. `src/data/storageKeys.ts` is the single
registry of the `x31desk:` keys, so a repository and the watcher can never drift
apart, and `src/data/crossTabSync.ts` is the only thing that listens for the
browser's `storage` event — the event every *other* same-origin document receives
when one of those values changes.

Each store and hook watches exactly the key it owns and re-reads through the same
`readStable` guard the initial load uses, so a create, edit, delete, completion,
archive, restore or preference change made in one tab appears in another without
a reload. `BroadcastChannel` is deliberately not used: the state already lives in
`localStorage`, whose own event carries the change, and a second channel could
only announce the same change twice.

The design is loop-free and quiet by construction. The `storage` event never fires
in the tab that wrote, so a tab cannot react to itself; a refresh only ever reads
and republishes, never writes; and the watcher is attached only while a store or
hook actually has a subscriber, so a store built in a test or a non-DOM process
attaches nothing. Where the API is missing the subscription is a no-op.

Refreshes are deliberately non-destructive. The notes workspace folds the stored
list back in but layers any edit still inside its debounce window on top and keeps
the current selection; the snippets workspace refreshes the list only and never
replaces the open editor's draft with another tab's version; and a theme change
arriving from another tab leaves the editor-preferences slice
referentially stable (and vice versa), so the code editor is not rebuilt for a
change that does not affect it.

**Concurrency limit (read-modify-write).** Synchronization is not conflict
prevention. Every mutation re-reads the whole collection and writes it back, and
that read-modify-write is not atomic across tabs: two tabs writing the same
collection at effectively the same instant can still have the later write discard
the earlier one (last write wins). The watcher narrows the window — a tab that has
just heard an event writes from the freshest state it can see, and the initial
load race is already handled — but it does not close it. A fully safe fix needs
the Web Locks API (`navigator.locks`) to serialize each read-modify-write across
tabs. That is intentionally deferred: it would make every write asynchronous and
so break the synchronous `beforeunload` flush that currently keeps the last
keystrokes from being lost when a tab closes. Until then the limitation is
documented rather than papered over. In practical single-user use the remaining
window is a same-instant double write to the same collection.

**Unreadable-data recovery.** A reader that meets bytes it cannot understand
copies them, once, to a sibling `:unreadable` key (`x31desk:notes:unreadable`,
`x31desk:tasks:unreadable`, and so on) before discarding them, so a bad payload
is never silently destroyed. `src/data/quarantine.ts` owns those keys, the
write-once preserve step and everything the Settings page needs to act on what
was kept: it detects which keys hold a payload and packages an exact copy —
never parsed or normalised — into a downloadable JSON file alongside the
storage key and export metadata. The payload's contents are never rendered in
the app; recovery is a file the user takes elsewhere. Nothing in this flow
removes or rewrites a payload: only "clear workspace data" still deletes
quarantined bytes, and the confirmation says so when any exist.

**Reporting a failure.** `src/data/storageError.ts` classifies the browser's own
failure signals — a full quota (`QuotaExceededError`) versus storage that is
unavailable or blocked (`SecurityError`) — trusting only those names and codes
and falling back to a generic message rather than guessing. Every read, write and
clear in the repositories runs through it, so a failure is tagged at the one
layer that touches `localStorage`, and the most recent kind is remembered so a
boolean-returning store can still explain itself after an action. A classified
failure becomes one concise, actionable sentence ("Storage is full, so nothing
could be saved or deleted…"); anything unrecognised keeps the existing generic
wording. A successful read or write forgets the remembered failure.

## Notes workspace

`src/pages/NotesPage.tsx` is the workspace: a searchable list on the left, the
open note on the right. Each layer has one job.

| Layer          | File                                   | Responsibility                                    |
| -------------- | -------------------------------------- | ------------------------------------------------- |
| Page           | `src/pages/NotesPage.tsx`              | Owns the search query and filters, wires it up    |
| State          | `src/hooks/useNotes.ts`                | Collection, selection, debounced autosave, flushes |
| Persistence    | `src/data/noteRepository.ts`           | The storage contract and its localStorage adapter |
| Presentational | `src/components/notes/*`               | List, row, editor — never touch storage           |
| Confirmation   | `src/components/ui/ConfirmDialog.tsx`  | Native `<dialog>` modal                           |

**Editing and autosave.** Title and content are written back on every keystroke,
so the list and the editor never lag behind the keyboard; only `updatedAt` waits
for the debounced write (500 ms). That is what stops the list re-ordering itself
mid-sentence, and it makes a save observable: the editor shows **Saving…** while a
write is pending and **Saved** once it lands. A write that fails reports **Not
saved** — with a short reason such as *storage full* when the failure could be
classified — rather than claiming success.

**Nothing is silently dropped.** A debounce window is a real risk of data loss, so
a pending edit is flushed — never cancelled — at every point where it could be
lost: selecting another note, deleting one, unmounting the workspace (navigating
away) and `beforeunload` (reloading or closing the window). This is why the
localStorage adapter performs its mutation synchronously inside each call: a
round-trip that outlived the page would lose the edit.

**Storage.** Notes live under `x31desk:notes` as a JSON array. Reads are
defensive — missing, unparseable, non-array and partially invalid payloads all
resolve to a usable list — and anything that cannot be understood is copied to
`x31desk:notes:unreadable` before being discarded, so a bad payload is never
silently destroyed. Every `NoteRepository` method is asynchronous even though
localStorage is synchronous: that is the shape a SQLite adapter over IPC will
have, so the UI is already written against it. `noteRepository` is the single
binding to swap.

**Ordering.** Notes are stored unordered and sorted for display by `updatedAt`, so
the note you are editing rises to the top of the list when its save lands.

## Tasks workspace

`src/pages/TasksPage.tsx` shows a filtered, searchable list beside a form dialog
for creating and editing tasks.

| Layer          | File                                   | Responsibility                                       |
| -------------- | -------------------------------------- | ---------------------------------------------------- |
| Page           | `src/pages/TasksPage.tsx`              | Owns the view tab, the search query and the dialog    |
| State          | `src/hooks/useTasks.ts`                | Reads and mutates the shared task store               |
| Store          | `src/data/taskStore.ts`                | Module-level store subscribed via `useSyncExternalStore` |
| Persistence    | `src/data/taskRepository.ts`           | The storage contract and its localStorage adapter     |
| Presentational | `src/components/tasks/*`               | Filters, list, row, checkbox, badges, dialog          |
| Confirmation   | `src/components/ui/ConfirmDialog.tsx`  | Native `<dialog>` modal                              |

Tasks live in a **shared store** rather than inside the page, because the dashboard
mutates them too: ticking a task off in either place is visible in the other
immediately, and the two views can never disagree.

**Views.** Four tabs — All, Today, Upcoming, Completed — each showing its own
count. **Today** includes overdue work; **Upcoming** is strictly future; **All** is
everything still open. Within a view the soonest due date comes first (undated
last), then the highest priority, then the oldest — so a list built up over time
keeps its shape while you type. Completed tasks order by most recently finished.

**A task** has a required title, an optional description, an optional due date
(`YYYY-MM-DD` — a local calendar day, deliberately not an instant, so it cannot
drift across a timezone boundary) and a priority (low / medium / high, default
medium). Completion is recorded with `completedAt`, which is what orders the
Completed tab.

**Storage.** Tasks live under `x31desk:tasks`, with the same defensive read and
`x31desk:tasks:unreadable` quarantine as notes.

## Snippets workspace

`src/pages/SnippetsPage.tsx` is a searchable, filterable list of code snippets
beside the snippet that is open.

| Layer          | File                                    | Responsibility                                       |
| -------------- | --------------------------------------- | ---------------------------------------------------- |
| Page           | `src/pages/SnippetsPage.tsx`            | Owns the search query and the language filter         |
| State          | `src/hooks/useSnippets.ts`              | Collection, open editor and debounced autosave        |
| Persistence    | `src/data/snippetRepository.ts`         | The storage contract and its localStorage adapter     |
| Presentational | `src/components/snippets/*`             | List, row, editor, copy button, language badge        |
| Editor         | `src/components/snippets/CodeEditor.tsx`| CodeMirror 6 wrapper: dark theme, line numbers        |
| Editor config  | `snippets/codeLanguage.ts`, `codeEditing.ts` | Language parsers and the Tab/Enter commands       |
| Clipboard      | `src/utils/clipboard.ts`                | Clipboard API with an `execCommand` fallback          |

**A snippet** is a title, its code, a language (one of JavaScript, TypeScript, HTML,
CSS, Python, Java, PHP, SQL, JSON, Bash, Plain Text) and optional comma-separated
tags. The editor holds the tag field as the raw text you typed, so a half-typed
tag survives, and the repository parses it into stored tags — trimmed, empty
entries dropped and duplicates removed case-insensitively.

**Title and code are required, and nothing incomplete is ever written.** A brand
new snippet is not persisted when you click **New snippet**: it lives as an
in-memory draft, marked **Unsaved**, until it has both a title and some code. The
first valid write is what creates it, so abandoning an empty one leaves no trace,
and storage can never contain a snippet that fails its own read validation —
its timestamps must be finite, matching the other collections.

**Search and filtering.** The search matches a snippet's title, its code and its
tags; the language filter narrows to a single language. The count line says what
you are looking at — `3 snippets`, or `1 of 3 snippets` once a filter is active.

**Copying.** **Copy code** writes to the clipboard through the asynchronous
Clipboard API, falling back to a hidden textarea when that is unavailable. The
button reports the real outcome — a check and *Copied* on success, a toast saying
the copy failed otherwise — and `Ctrl+Shift+C` copies the open snippet while the
editor is open. List rows carry the same copy action, revealed on hover or keyboard
focus.

**Editing and autosave** work exactly as they do for notes (500 ms debounce,
**Saving…** / **Saved** / **Not saved** with a short reason when the failure is
known, flushed on selection change, delete, unmount and `beforeunload`).

**Ordering.** Snippets are listed newest first by *creation*, not by last edit: the
list is a browsing surface with an autosaving editor beside it, so it must not
re-order itself under the pointer while an edit is being written.

**A real code editor, driven by the chosen language.** The code field is
[CodeMirror 6](https://codemirror.net/) (`src/components/snippets/CodeEditor.tsx`),
styled with the [Tokyo Night](https://github.com/folke/tokyonight.nvim) theme
(`@uiw/codemirror-theme-tokyo-night`) in JetBrains Mono at medium weight. Its dark
surface stays dark in **both** app themes so code always reads the same against the
light or dark chrome. It keeps indentation, blank lines and trailing whitespace,
wraps long lines rather than scrolling sideways, and adds line numbers, an
active-line highlight and bracket matching by default.

Font size, font weight, line numbers, the active-line highlight and bracket
matching are the editor preferences on the **Settings** page (below). They reach
the editor through a CodeMirror `Compartment`, so a change reconfigures the open
editor in place — the document, selection and undo history all survive — and the
whole set persists under `x31desk:editor`.

The parser follows the **Language** dropdown: JavaScript, TypeScript, HTML, CSS,
Python, Java, PHP, SQL, JSON and Bash each load their own CodeMirror language, and
**Plain Text** loads none. Switching language re-highlights immediately without
touching the code.

Editing is opinionated and deterministic (`src/components/snippets/codeEditing.ts`),
independent of any parser:

- **Tab** inserts four spaces at the caret (or indents every selected line);
  **Shift+Tab** removes up to four leading spaces from each selected line.
- **Enter** carries the current line's indentation into the new line, adds one four
  space level when the line ends in `{`, `[` or `(`, and — pressed between a matching
  pair such as `{}` — opens the pair into an indented inner line and an outer line
  with the caret left on the inner one.
- Typing `{`, `[`, `(`, `"`, `'` or `` ` `` auto-closes its partner, and the caret,
  selection, undo history, paste and delete behaviour are CodeMirror's own.

**Storage.** Snippets live under `x31desk:snippets`, with the same defensive read
and `x31desk:snippets:unreadable` quarantine as notes.

## Archive

`src/pages/ArchivePage.tsx` gathers everything set aside from the three
workspaces into one searchable, filterable list.

| Layer          | File                                     | Responsibility                                          |
| -------------- | ---------------------------------------- | ------------------------------------------------------- |
| Page           | `src/pages/ArchivePage.tsx`              | Owns the filter tab, the search query and the delete dialog |
| Coordination   | `src/data/archiveStore.ts`               | Moves records between a workspace and the archive        |
| State          | `src/hooks/useArchive.ts`                | Reads the archive store and exposes restore / delete     |
| Persistence    | `src/data/archiveRepository.ts`          | The storage contract and its localStorage adapter        |
| Presentational | `src/components/archive/*`               | List, row, type badge, filter bar                        |

**Archiving is reversible; deleting is not.** Each workspace owns its own archive
action — the button in the note editor, the row action on a task, the button in
the snippet editor — and each one moves the record out of its workspace and into
the archive without touching its content. Restoring puts it back exactly where it
came from, with its original id, content and metadata; **permanent delete** is the
only destructive action and is the only one behind a confirmation.

**One store, two moves.** An archive action changes two places, so it goes through
`archiveStore` rather than the page: the record is written into the archive first,
and only then removed from the workspace. If the second step fails the first is
rolled back, so a record can never be in both places or neither — the failure mode
that would otherwise lose data. Restoring runs the same sequence in reverse,
writing into the workspace repository before releasing the archived copy.

**One record shape.** Every archived entry wraps the original record verbatim
under its own key and adds only `archivedAt`:

```jsonc
{ "type": "task", "archivedAt": 1728900000000,
  "task": { /* the task exactly as the tasks workspace stored it */ } }
```

The union is discriminated by `type`, so the archive can render a note, a task and
a snippet in one list while each keeps the fields its own workspace expects, and a
record's identity (`type:id`) survives the round trip. Writes are an upsert keyed
by that identity, so the same record can never be archived twice.

**The active views stay honest.** Because archiving goes through the same stores
the rest of the app reads, an archived task stops counting toward the dashboard's
totals the moment it is archived, and an archived note or snippet disappears from
its list immediately — no stale counts, no phantom rows.

| Action            | Notes                              | Tasks                                    | Snippets                            |
| ----------------- | ---------------------------------- | ---------------------------------------- | ----------------------------------- |
| Archive           | Editor `Archive` button            | Row `Archive` action                     | Editor `Archive` button             |
| Restore           | From the Archive page              | From the Archive page                    | From the Archive page               |
| Permanent delete  | Confirmed from the Archive page    | Confirmed from the Archive page          | Confirmed from the Archive page     |

A snippet is only archivable once it has been saved — an empty, never-written
draft has nothing to preserve — and archiving it flushes any pending edit first,
so the copy that is set aside is the copy you last saw.

**Search and filters.** The type tabs (All / Notes / Tasks / Snippets) carry a
count each, and the search matches an item's title and, where it has one, its body
(notes and tasks) or its code (snippets) — so the archive is findable by content,
not just by name.

**Storage.** Archived records live under `x31desk:archive`, separate from the
active workspaces, with the same defensive read: a missing, unparseable,
non-array or partially invalid payload never breaks the page, the entries that can
be understood are kept, and anything that cannot is copied to
`x31desk:archive:unreadable` before being discarded.

## Settings

`src/pages/SettingsPage.tsx` is a compact preferences workspace: a sticky section
rail beside five clearly separated sections. It is the one place the user controls
appearance, the code editor, the keyboard shortcuts they can discover, and their
local data.

| Layer          | File                                                    | Responsibility                                             |
| -------------- | ------------------------------------------------------- | ---------------------------------------------------------- |
| Page           | `src/pages/SettingsPage.tsx`                            | Composes the sections and owns the clear dialog             |
| State          | `src/data/settingsStore.ts`                             | Theme + editor preferences, shared and persisted           |
| Hooks          | `src/hooks/useSettings.ts`, `useEditorPreferences.ts`   | Read the store; the editor hook selects only its slice      |
| Reset          | `src/data/workspaceReset.ts`                            | Clears every collection through the repositories and stores |
| Recovery       | `src/data/quarantine.ts`                                | Detects and exports preserved unreadable payloads           |
| Presentational | `src/components/settings/*`                             | Section, nav, toggle row, field row, recovery row           |

**One store, not a context.** The settings store is a module-level value consumed
through `useSyncExternalStore`, exactly like the task and archive stores. Theme used
to live inside `useTheme` at the app root; it could not stay there once the Settings
page also had to change it, so the top-bar toggle and the page now read and write the
same object and can never disagree.

**Appearance.** Light, Dark or System. What is persisted is the *preference*, under
`x31desk:theme` — the key the app has always used, so existing installs keep their
choice — while the value applied to `<html data-theme>` is the resolved theme.
`system` listens to `prefers-color-scheme` and re-resolves and repaints the moment
the OS changes, no reload required. The top-bar toggle flips to the opposite
*applied* theme as an explicit choice, which also leaves System mode.

**Code Editor.** Font size (12–20 px), font weight (Normal / Medium / Semibold — the
JetBrains Mono weights the app actually ships) and switches for line numbers,
active-line highlight and bracket matching. The shipped defaults — 12 px, medium
weight, all three decorations on — are exactly how the editor looked before it had
settings. The theme appears as **Tokyo Night** but is deliberately not a choice:
there is only one editor theme, and a picker that did nothing would be a lie. Editor
preferences persist under `x31desk:editor`, are validated on read, and ride in the
editor's `Compartment` (see the snippets section) so they apply live.

**Workspace.** The storage row says plainly that everything lives in the browser's
local storage and that a future Electron build may move it to SQLite. When a reader
has had to set unreadable data aside, a small notice appears here naming the
affected collections and offering **Export unreadable data**; it is hidden
otherwise. The export is a JSON file containing the exact preserved bytes plus
their storage keys and metadata, generated by `src/data/quarantine.ts` — the
payloads are never shown in the app, and exporting never changes or deletes them.
**Clear all workspace data** empties notes, tasks, snippets and the archive in one
confirmed step. Nothing is removed until the confirmation is accepted, and that
confirmation states the deletion is permanent *and* that preferences are kept. The
clear runs through the repositories, so the same defensive reads apply, and it
empties the in-memory task and archive stores too — the dashboard and every
workspace drop their rows immediately, without a reload. The theme and editor
keys are not reachable from the reset, so clearing content can never
reset a setting.

**Keyboard Shortcuts.** Every implemented shortcut, grouped into **Navigation** and
**Actions**, with the keys spelled as `Kbd` chips on the row's trailing edge. The
rows are not maintained by hand: the section maps straight over the registry in
`src/shortcuts/shortcuts.ts` that the dispatcher resolves against, so the list
cannot describe a binding the app does not have (see
[Keyboard shortcuts](#keyboard-shortcuts)).

**About.** The product name, its description and the version. The version is not
typed by hand: `vite.config.ts` reads it from `package.json` at build time and injects
it as `__APP_VERSION__`, declared in `src/vite-env.d.ts`. There are no links, because
there is nowhere correct for them to go yet.

### Backup and restore

Two Workspace rows, available in the desktop shell only. **Back up data** writes
the whole SQLite workspace to a single file the user names in a native save
dialog; **Import from backup** reads one back through a native open dialog. In
the browser the rows are shown disabled with the reason spelled out, because
there the workspace is not in a database this feature can read or write.

| Layer     | File                                            | Responsibility                                                 |
| --------- | ----------------------------------------------- | -------------------------------------------------------------- |
| Renderer  | `src/data/backup.ts`                            | Orchestration, preference read/apply, reload decision           |
| UI        | `src/components/settings/BackupData.tsx`        | The two rows, the preview dialog and the replace confirmation   |
| IPC       | `electron/ipc/backupHandlers.ts`                | Three channels: `backup.export`, `backup.inspect`, `backup.apply` |
| Format    | `electron/db/backup.ts`                         | Document shape, validation, merge/replace, export orchestration |
| Files     | `electron/db/backupFiles.ts`                    | The `node:fs` port (`size`/`read`/`writeAtomic`/`remove`)       |
| Shared IO | `electron/db/workspaceIO.ts`                    | Whole-workspace readers/writers shared with the migration       |

**The file.** A `.x31backup` file is UTF-8 JSON. The suggested name is
`x31Desk-backup-YYYY-MM-DD.x31backup`; the user may choose any path and name.

```jsonc
{
  "format": "x31desk.backup",
  "formatVersion": 1,
  "appVersion": "0.1.0",          // informational
  "databaseVersion": 2,           // SQLite schema the file was written against
  "exportedAt": "2026-10-19T10:00:00.000Z",
  "counts": { "notes": 2, "tasks": 1, "snippets": 0, "archive": 3 },
  "notes":   [ /* the app's own Note records, verbatim */ ],
  "tasks":   [ /* Task records */ ],
  "snippets":[ /* Snippet records, tags included */ ],
  "archive": [ /* ArchivedItem records */ ],
  "preferences": { "theme": "dark", "editor": { /* … */ } }
}
```

Records are stored as the application's own types — ids, timestamps, ordering and
every field intact — because the file is a faithful copy of one workspace, not an
interchange format. `format` is checked first, so a recovery export, a JSON blob
or a photograph is refused before any of its contents are looked at;
`formatVersion` must equal the version this build reads (a newer file is refused
rather than partially imported); `counts` is checked against the arrays, so a
truncated or hand-edited file is refused rather than trusted half-way. Every
record is re-validated with the same guards the storage layer uses (`isNote`,
`isTask`, `isSnippet`, `isArchivedItem`). Limits are 64 MiB per file and 100 000
records per collection. Only the two preferences named above are carried, and
only the keys that were actually present: a backup that does not mention a
setting does not reset it. Keys this build does not recognise are ignored rather
than refused — a file written by an older version that carried a `uiScale`
preference still imports, it simply does not restore that retired setting. No
path, machine name or other local detail is included.

**Export.** Pending saves are flushed first — a debounced edit that had not
reached the database would otherwise be missing, and a flush that fails refuses
the export rather than writing a silently incomplete file. The snapshot is then
read inside one transaction, written to a sibling temporary file and renamed into
place, re-read and compared against the snapshot, and removed again if that
verification fails; the user therefore never sees a half-written backup. Archive
rows whose stored payload cannot be read back are counted and reported, never
silently dropped and never quarantined as a side effect — they stay in the
database for **Export unreadable data**.

**Import is two steps.** The picker, read and validation happen first and write
nothing; what comes back is a preview — the file name, the version that wrote it,
when, the four counts and whether preferences are carried — plus the validated
document. The user then chooses a mode, and *replace* passes through a second,
destructive confirmation. Cancelling at any point, closing the dialog, a refused
file, a failed validation or a failed transaction all leave the workspace exactly
as it was.

**Add to this workspace (merge, the default)** inserts the records the workspace
does not already have and leaves every other record alone. A record the workspace
already holds with identical content is counted as unchanged; one whose id matches
but whose content differs is reported as a conflict and **kept as it is** — the
local copy always wins, and nothing is overwritten silently. Merge holds no
transaction open while the comparison runs; the whole write happens inside one
`BEGIN IMMEDIATE` transaction and is followed by a full canonical re-read that
verifies the destination holds the merged result. It is idempotent: importing the
same file twice inserts nothing the second time.

**Replace this workspace** clears notes, tasks, snippets and the archive inside
one transaction, restores the backup, and verifies the result matches. It
deliberately does **not** touch the migration marker in `meta` or the
archive-corruption vault, so a replace cannot make the app try to re-import
`localStorage` or destroy preserved unreadable rows.

**Preferences are restored by either mode.** The preview says beforehand whether
the file carries them, and a preference the file does not mention is left exactly
as it is. The alternative — making a merge strictly about records, so the only way
to get a theme back would be to delete the workspace first — was considered and
rejected: a backup is one snapshot, and refusing half of it is more surprising
than the disclosure the dialog already gives.

**After an import** the new preferences are written into `localStorage` by the
renderer (the main process cannot reach it) and, when anything actually changed,
the page reloads once so the task and archive stores — which load once per
session — pick up the new contents. A merge that inserted no record and restored
no preference is reported as a no-op and says *"Nothing to import"* instead;
conflicts alone do not make it a change, because a conflict writes nothing.

## Desktop shell (Electron)

`electron/` runs the application above as a Windows desktop app without changing
it. The detail lives in [`electron/README.md`](electron/README.md); the shape is:

- **Main** (`electron/main.ts`, bundled to `electron/dist/main.mjs`) owns the
  single `BrowserWindow`, the lifecycle and the SQLite database. It holds no
  application state; the renderer still persists to `localStorage`. The
  repository adapters that will read and write the database are not built yet.
- **Preload** (`electron/preload.ts`, bundled to `electron/dist/preload.cjs`) is
  sandboxed and publishes one small, typed global — `window.x31deskDesktop` —
  never `ipcRenderer` and never a generic `invoke(channel, …)`. Its types are
  `src/types/desktop.ts`.
- **Renderer** is the existing React app, unchanged.

The shell is TypeScript. `scripts/build-electron.mjs` bundles both entry points
with the project's own Vite — the main process as an ES module, the preload as
CommonJS (a sandboxed preload cannot be an ES module) — into the gitignored
`electron/dist/`. `npm run build`, `npm start` and `npm run dev:electron` all run
it first. Bundling is also what lets the two sides share their channel names
through `src/data/ipc/contract.ts` instead of mirroring them by hand.

The main process opens a SQLite database at `x31desk.db` in the app's user-data
directory, using Node's built-in `node:sqlite` (shipped with Electron's Node, so
no dependency and no native rebuild). It is versioned with `PRAGMA user_version`
through a forward-only migration chain: each step runs in a transaction and
advances the version only after it succeeds, and a file from a newer build is
refused rather than downgraded. Initialisation is all-or-nothing — a failure
throws and is logged, never reported as ready. **Nothing reads or writes the
database yet**: the renderer keeps persisting to `localStorage`, and no records
are migrated.

Security is the default posture, set explicitly: `contextIsolation: true`,
`nodeIntegration: false` and `sandbox: true`; new windows are denied (external
`http(s)` links go to the OS browser) and in-app navigation is confined to the
loaded document. A restrictive `Content-Security-Policy` (`default-src 'self'`,
`script-src 'self'`) is injected into the built page by `vite.config.ts`, relaxed
only for the dev server's inline React-refresh preamble and HMR websocket.

`npm run dev:electron` starts the Vite dev server through Vite's Node API and
opens Electron against it, so the shell and the web workflow share one server and
HMR works inside the window. `npm start` loads the built `dist/index.html` over
`file://` (which is why the build uses `base: './'`). `file://` is a secure
context, so `crypto.randomUUID`, the clipboard and `localStorage` behave exactly
as they do on the web.

Two things worth stating plainly. First, the desktop app opens **one** window, so
the cross-tab synchronization described under [Storage](#storage) is inert here —
one window is one writer, and the last-write-wins limit cannot be reached. Second,
`localStorage` is still the only **store the app reads and writes**: closing the
window normally flushes it to the app's user-data directory, but an abrupt
process termination can drop a very recent write. The SQLite database described
above is opened and versioned, but nothing is migrated into it and no repository
is bound to it yet — moving the four repositories onto it, behind their existing
interfaces, is the next step and is deliberately not done in this phase.

## Verifying navigation, dashboard and theming

1. `npm run dev`, then open http://localhost:5173/
2. On **Home**, check that the greeting matches the time of day, the three overview
   cards read `0` on a fresh workspace, and both sections show their empty state.
3. Click a quick action: **Create a note** opens a fresh note, **Add a task** opens
   the new-task form in the tasks workspace, and **Browse snippets** opens
   Snippets.
4. Click **Open notes** / **Open tasks** in the section headers — they navigate to
   those pages and the sidebar highlight follows.
5. Click **Notes / Tasks / Snippets / Archive** in the sidebar — the sidebar
   highlight, the breadcrumb in the top bar and the page heading all change;
   Settings is in the sidebar footer and also reachable from the ⚙ button.
6. Click **☾** in the top bar — the whole UI switches to the dark token set.
7. Press `F5` — the dark theme is restored from `localStorage`.
8. Press `Ctrl+K` (or click the search field) — the workspace-search dropdown
   opens; `Esc` closes it. (See "Verifying workspace search and dropdowns" below.)
9. Clear the site's `localStorage` and reload — the app is back to light.

## Verifying the notes workspace

1. Open **Notes** from the sidebar with nothing stored: the empty state explains
   where notes live and offers a **New note** action.
2. Click **New note** — a note is created, opens in the editor and the caret is
   already in the title.
3. Type a title, then a body. **Saving…** appears as you type and settles on
   **Saved** about half a second after you stop. The row's title and preview
   update as you type and the row rises to the top of the list when the save lands.
4. Create a second note and confirm it sorts above the first (most recently
   updated first).
5. Type into one note and immediately click the other: the first note's text is
   still there when you go back — the pending write was flushed, not dropped.
6. Search a word from a title, then a word that appears only in a body: both
   filter the list. A search with no matches explains itself; **×** clears it.
7. Click **Delete** — the confirmation names the note. **Cancel** keeps it;
   **Delete note** removes it, acknowledges with a toast and selects the
   neighbouring note. Deleting the last note returns to the empty state.
8. Reload the window (`F5`): the notes are still there and the most recently
   updated one reopens on its own.
9. Type something and press `F5` without waiting: the text is still there after the
   reload.
10. Toggle **☾** — the workspace follows the dark theme and the editor keeps
    readable contrast.
11. Go back to **Home**: the overview's **Notes** count matches the number of notes
    you created.
12. Resize to 1366×768: the list and the editor each scroll on their own and the
    page itself does not scroll. Narrower than ~1024px they stack vertically.
13. In DevTools, set `localStorage['x31desk:notes']` to `{oops` and reload: the
    workspace opens empty instead of breaking, and the original value is preserved
    under `x31desk:notes:unreadable`.

## Verifying the tasks workspace

1. Open **Tasks** with nothing stored: the empty state offers a **New task** action.
2. Click **New task** — the form opens with the caret already in the title. Try to
   save with an empty title: it is refused and the field is marked invalid.
3. Save a task due today and one due next week. The **All** tab lists them
   soonest-first and the Today / Upcoming tab counts match.
4. Add a task with a past due date: it appears under **Today** alongside today's
   work (that view is "today or earlier"), while the dashboard's **Tasks due
   today** count stays literal.
5. Give two tasks the same due date but different priorities: the higher priority
   sorts first.
6. Type in the search box: only tasks whose title matches remain.
7. Tick a task's checkbox: it leaves the open lists, the **Completed** count rises,
   and it is ordered most-recently-finished first.
8. Click **Delete** on a task: the confirmation names it. **Cancel** keeps it;
   **Delete task** removes it, acknowledges with a toast and updates the counts.
9. Go to **Home**: the overview counts match, and ticking a task off under
   **Today's focus** updates the numbers immediately.
10. Reload (`F5`): every task is still there.
11. In DevTools, set `localStorage['x31desk:tasks']` to `{oops` and reload: the
    workspace opens empty and the original value is preserved under
    `x31desk:tasks:unreadable`.

## Verifying the snippets workspace

1. Open **Snippets** with nothing stored: the empty state explains where snippets
   live and offers a **New snippet** action.
2. Click **New snippet** and type only a title: the status reads **Unsaved** and no
   row appears — nothing is written until there is both a title and some code.
3. Paste a multi-line snippet (indentation, tabs, blank lines). **Saving…** appears
   and settles on **Saved**, and the row shows the title, a one-line preview and the
   line count. The code field is a dark CodeMirror editor with line numbers in the
   gutter and a highlighted active line.
4. Confirm the whitespace survived: the stored code is byte-for-byte what you typed
   and the code field soft-wraps instead of scrolling sideways.
5. Press `Tab` on an empty line: four spaces appear and focus does **not** leave the
   editor. Select several lines and press `Tab` — each is indented one level;
   `Shift+Tab` removes one level again.
6. Type `if (x) {` and press `Enter`: the new line is indented one level deeper than
   the `if`, and typing `}` on its own line snaps back. Type `{` alone and press
   `Enter` between the auto-inserted pair: the braces are opened across three lines
   with the caret on the indented inner line.
7. Pick a language and type `react, hooks, React` as tags: the duplicate collapses
   to one, and the row shows the language badge and its tags.
8. Change the **Language** dropdown — the code re-highlights immediately without
   moving. Choose **Plain Text**: the highlighting goes away. In both app themes the
   editor surface stays dark; only the surrounding chrome follows ☾.
9. Click another snippet in the list: the edit you were typing is flushed, not lost,
   and the editor swaps to that snippet's code and language.
10. Search a word from a title, then one that appears only in the code, then a tag —
    all three filter the list. Filter by language and the count line becomes
    `1 of N snippets`; a search with no matches explains itself.
11. Click **Copy code**: a check and a toast confirm, and the code is on your
    clipboard. Press `Ctrl+Shift+C` while the editor is open for the same result, and
    hover a list row to use its own copy button.
12. Clear the title of an existing snippet: the status reads **Unsaved** and the
    stored snippet is unchanged — the last valid version is what stays saved.
13. Click **Delete**: the confirmation names the snippet. **Cancel** keeps it;
    **Delete snippet** removes it, acknowledges with a toast and opens the
    neighbouring snippet.
14. Reload (`F5`): the snippets are still there and the newest reopens on its own.
15. Toggle **☾**: the list and chrome follow the dark theme while the code editor
    stays on its own dark surface.
16. In DevTools, set `localStorage['x31desk:snippets']` to `{oops` and reload: the
    workspace opens empty and the original value is preserved under
    `x31desk:snippets:unreadable`.
17. Resize to 1366×768: the list and the editor sit side by side and each scrolls on
    its own; narrower than ~1024px they stack vertically.

## Verifying the archive

1. Open **Archive** with nothing archived: the empty state explains that archiving
   keeps things out of the way without deleting them.
2. In **Notes**, open a note and click **Archive**: the note leaves the list, a
   toast confirms it, and **Home**'s **Notes** count drops by one.
3. Open **Archive**: the note is listed with a **Note** badge, its archived date and
   a preview of its body. Click **Restore** — it disappears from the archive, and
   it is back in **Notes** with its content, title and id intact.
4. Archive a task from its row in **Tasks**: it leaves the list, and **Home**'s
   **Tasks due today** count no longer includes it (or **Today's focus**).
5. Restore it from the archive and check the task is back in **Tasks** and the
   dashboard counts it again.
6. Archive a snippet from its editor, then restore it: the code, language and tags
   come back unchanged. A brand-new, never-saved snippet shows no **Archive**
   button until it has been written.
7. Archive several items of different kinds and use the **All / Notes / Tasks /
   Snippets** tabs: each shows its own count and only its own kind.
8. Search a word from a title, then a word that appears only in a note's body, a
   task's description or a snippet's code — all three match.
9. Click **Delete** on an archived item: a confirmation names it. **Cancel** keeps
   it archived; **Delete permanently** removes it for good — it does not reappear
   in its workspace. Archiving the same item twice never produces two entries.
10. Reload (`F5`): archived items are still archived, restored items are still in
    their workspaces, and nothing has moved.
11. In DevTools, set `localStorage['x31desk:archive']` to `{oops` and reload: the
    archive opens empty instead of breaking, and the original value is preserved
    under `x31desk:archive:unreadable`.

## Verifying the settings

1. Open **Settings** (the sidebar footer or the ⚙ button). The four sections are
   listed in the rail and each scrolls into view.
2. Under **Appearance**, choose **Dark**: the whole UI switches. Press `F5` — it is
   still dark and the control still reads Dark.
3. Click **☾** in the top bar: the preference becomes an explicit **Light** and the
   Settings control follows it. Choose **Dark** again to carry on.
4. Choose **System**, then change your OS appearance (or DevTools → Rendering →
   Emulate `prefers-color-scheme`): the app follows live, and the stored value stays
   `system`.
5. Under **Code Editor**, set the size to 16 px and the weight to Semibold, and turn
   off line numbers, active-line highlight and bracket matching. Open **Snippets**:
   the code is larger, heavier, unnumbered and unhighlighted with no reload. Press
   `F5` and reopen Snippets — the same preferences are back.
6. In the snippets editor confirm the code surface is still dark even in Light mode,
   and that indentation, autosave, `Ctrl+Shift+C` copying and language switching are
   unaffected.
7. Under **Workspace**, note the storage line. Add a note, a task, a snippet and an
   archived item, then click **Clear data** and press **Cancel**: everything is
   still there.
8. Click **Clear data** again and confirm: the toast appears, **Home**'s counts drop
   to zero, and Notes / Tasks / Snippets / Archive are all empty — without a reload.
   The Theme and editor preferences you set are unchanged.
9. Under **About**, check the name and description, and that the version matches
   `package.json`.
10. In DevTools, set `localStorage['x31desk:editor']` to `{oops` and reload: the
    editor opens with its defaults instead of breaking.
11. In DevTools, set `localStorage['x31desk:notes:unreadable']` to `{oops` and reload:
    **Settings → Workspace** shows the recovery notice naming Notes and offering
    **Export unreadable data**. The payload text never appears on the page. Click the
    action: a `x31desk-recovery-*.json` file downloads containing the exact `{oops`
    string and its `x31desk:notes:unreadable` key. The stored value is unchanged, and
    clearing workspace data removes both the key and the notice.

## Verifying workspace search and dropdowns

1. On any page, press `Ctrl+K` (or `/` when not typing in a field): focus jumps to
   the top-bar search field and the dropdown opens with a hint explaining what it
   searches. `Esc` closes it.
   Also press `Ctrl+N` from another workspace: it aims at the section you are in —
   on **Tasks** it opens the task dialog, on **Snippets** a blank snippet, and from
   Home or Archive a fresh note in **Notes**. (Browsers reserve `Ctrl+N` for "new
   window" on Chromium and may handle it before the page sees it; the app wires it
   up, but the browser can win.)
2. Type a word that appears in a note title and another note's body: both appear
   under **Notes**, the title hit first. Keep typing until nothing matches — the
   dropdown says so rather than showing an empty box.
3. Search a word from a task description and a snippet's code or a tag: the
   **Tasks** and **Snippets** groups appear with those rows.
4. Use `↓` / `↑` to move the highlight, then `Enter`: a note opens selected in
   **Notes**, a task opens its edit dialog in **Tasks**, and a snippet opens in the
   editor in **Snippets**. This also holds when you are *already* in the matching
   workspace: pick a different note from the search while on **Notes** and the
   editor switches to it rather than doing nothing.
5. Archive a note, then search its title: it appears under the **Archive** group
   (not **Notes**). `Enter` opens **Archive** with its search already filled in,
   showing the item.
6. Confirm each workspace's own search and language/tab filters still work while the
   global field is present.
7. Focus the field again after editing an item: the results reflect the latest
   content (the field re-reads on focus).
8. Open **Settings** and the snippet editor and click each dropdown: the menu is a
   themed panel with a border, radius and shadow, it is never clipped by the
   surrounding card, and it flips above the trigger near the bottom of the window.
9. Keyboard-drive a dropdown: `↓`/`↑` move the highlight, `Enter` selects, `Esc`
   closes and returns focus to the trigger, and clicking outside closes it. Confirm
   no native `<select>` popup appears anywhere in the app — every dropdown is the
   themed custom control.

## Verifying keyboard shortcuts

1. Press `Ctrl+1` … `Ctrl+6` in order: the sidebar highlights Home, Notes, Tasks,
   Snippets, Archive and Settings in turn, and `Ctrl+6` lands on **Settings** with
   the **Keyboard Shortcuts** section listing exactly the keys you just pressed.
2. On **Notes** press `Ctrl+N`: a fresh, focused note appears. On **Tasks** the
   same key opens the **New task** dialog; on **Snippets** a blank snippet.
3. With the task dialog open, press `Ctrl+3`: nothing happens — navigation,
   creation and `F2` stand down behind a modal dialog. Press `Esc` instead: the
   dialog closes and no other view changes.
4. Type into the note body and press `Ctrl+S`: the save indicator settles at once
   (the pending debounce is flushed) and a "All changes saved." toast confirms —
   no dialog appears, and autosave still writes on its own afterwards.
5. With a note or snippet open, press `F2`: focus jumps to the title field with
   the text selected, ready to retype. Press `F5`: pending writes flush and the
   workspace reloads.
6. Confirm the editing keys are untouched: `Ctrl+C/V/X/A/Z/Y/F`, undo/redo in the
   snippets editor, and `Ctrl+A` inside a field all behave exactly as before.

## Verifying cross-tab synchronization

Open the app in two tabs (or two windows of the same browser) side by side; both
share one `localStorage`.

1. Create a note in the first tab. Without reloading, it appears in the second
   tab's list; select it there and it shows what you typed.
2. Edit a note in the second tab and watch the first: the updated content and its
   position in the list move across. Do the same for a task title, a task
   completion, a snippet's code, and a settings change (switch to **Dark** in one
   tab — the other repaints immediately, including the top-bar toggle).
3. Archive a note in the first tab: it leaves the second tab's notes list and
   appears in its archive. Restore it and watch it return. Delete a task and watch
   it disappear in the other tab. Delete an item for good from the archive.
4. Leave an unsaved edit inside the 500 ms debounce window in the first tab, then
   make an unrelated change in the second: the first tab keeps your in-progress
   text rather than reverting to the stored version. With a snippet open and being
   typed into, a change to a *different* snippet in the other tab must not rebuild
   or refocus the editor.
5. Confirm no feedback loop: each tab updates once per change, the Network/CPU does
   not spin, and the tab you typed in does not re-render through an event (the
   `storage` event only fires in the other tabs).
6. Open a fresh third tab: it loads the current workspace, not a stale snapshot.

**Known limit.** Two tabs writing the *same* collection at the same instant are
still last-write-wins (see **Concurrency limit** under Storage); reproducing it
reliably needs both writes to land within the same instant, which is not the
common case and is not something the UI can fully prevent today.

## Verifying the desktop shell

1. `npm run dev:electron` — the Vite dev server starts, then an `x31Desk` window
   opens. Edit a note and watch the console: HMR still works inside the window.
2. `npm run build`, then `npm start` — the same window opens from `dist/` over
   `file://`. Open DevTools and confirm the Console has no errors and no
   `Content-Security-Policy` refusals.
3. In DevTools, run `await window.x31deskDesktop.getAppInfo()` — it resolves with
   the Electron, Chromium and Node versions, proving the preload bridge and the
   `x31desk:app-info` IPC channel work. Run `window.x31deskDesktop` in a plain
   browser and it is `undefined`, as it should be.
4. Create a note, close the window, and run `npm start` again — the note is still
   there, so `localStorage` persisted across a restart under `file://`.
5. Launch `npm start` twice: the second launch focuses the existing window rather
   than opening a second one (single-instance lock).
6. Watch the terminal while the app starts and stops: the main process logs
   `[x31desk] database ready at … (schema v2)` on launch and
   `[x31desk] database closed` on a clean quit. The `x31desk.db` file appears in
   the app's user-data directory.

## Verifying backup and restore

Backup and restore only exist in the desktop shell; in the browser the two
Settings rows are disabled and say why. The file dialogs are native, so the
steps below are manual — the automated suite drives the handlers directly
(`tests/backup.test.ts`, `tests/backupFiles.test.ts`) and checks only that the
rows are present and enabled in the desktop build (`scripts/e2e.mjs`).

1. In `npm start`, open **Settings → Workspace**. Add a note, a task, a snippet
   with two tags and an archived item, then set the theme to Dark and the editor
   font size to 16 px.
2. Click **Back up…**. A native save dialog opens suggesting
   `x31Desk-backup-<today>.x31backup`. Cancel it: nothing is written and no toast
   appears.
3. Click **Back up…** again and save. A toast names the record counts and the
   file. Open it in a text editor: it is JSON beginning `{"format":"x31desk.backup"`,
   with every record, its ids and timestamps, and a `preferences` section.
4. **Import into the same workspace.** Clear the workspace (**Clear data**), then
   click **Import…**, cancel the picker — nothing happens. Click it again, choose
   the file: a preview dialog opens showing the file name, version, date, the four
   counts and that preferences are carried. Press **Cancel** — the workspace is
   still empty.
5. Reopen the preview and choose **Add to this workspace**: the records come back,
   a toast reports what was imported and the page reloads. **Home**'s counts match
   what you saved.
6. **Merge does not overwrite.** Edit the note's body, then import the same file
   again. The preview appears; import it: the toast reports that the record was
   kept as it is, your edit is unchanged, and nothing else is duplicated.
7. **Merge is idempotent.** Import the same file once more with no local edits:
   the toast says *"Nothing to import"* and the page does **not** reload.
8. **Replace is explicit.** Add an extra note, then import the file and choose
   **Replace this workspace** — a second, destructive confirmation appears naming
   what will be deleted. Cancel it: your extra note is still there. Repeat and
   confirm: the workspace is now exactly the backup, the extra note is gone, and
   the theme and editor preferences are restored from the file.
9. **A file that is not a backup is refused.** Rename any other file to
   `something.x31backup`, choose it in the picker: a toast explains it is not a
   backup and nothing changes. Do the same with a hand-edited copy of a real
   backup (change `formatVersion` to `2`, or delete a record without fixing
   `counts`): each is refused with its own message.
10. **Archive-corruption recovery is unaffected.** Make an archive row unreadable
    (see the settings steps), take a backup: the toast says unreadable records
    were left out, and **Export unreadable data** still offers them. A **Replace**
    import must not remove that preserved row.

## Roadmap

1. ~~Foundation: project setup, design tokens, typography~~
2. ~~Application shell: sidebar, top bar, navigation, light/dark theming~~
3. ~~Home dashboard: welcome header, overview, sections, quick actions~~
4. ~~Notes: list, editor, search, delete and local persistence~~
5. ~~Tasks: views, search, form dialog, priorities, due dates, completion~~
6. ~~Snippets: list, autosave editor, languages, tags, search, clipboard~~
7. ~~Archive: unified archived list, archive / restore / permanent delete~~
8. ~~Settings: appearance, code-editor preferences, local data, about~~
9. ~~Workspace search: one field across notes, tasks, snippets and the archive~~
10. ~~Themeable dropdowns: a custom `Select` replacing every native `<select>`~~
11. ~~Electron desktop shell: window, security boundary and typed IPC seam~~
12. Command palette: a searchable list of every action and destination
13. SQLite persistence behind the existing repository interfaces — main-process
    database, schema versioning and the shared IPC contract are in place;
    repository adapters and the one-time migration are next
14. Windows installer and auto-update
