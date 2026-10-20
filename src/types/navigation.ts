import type { LucideIcon } from 'lucide-react'

/**
 * Every top-level destination in the application shell.
 *
 * The shell renders exactly one view at a time, so a view id doubles as the
 * "route" without pulling in a router.
 */
export type ViewId = 'home' | 'notes' | 'tasks' | 'snippets' | 'archive' | 'settings'

/** A single entry in the workspace navigation. */
export type NavEntry = {
  id: ViewId
  /** Shown in the sidebar and reused as the page title. */
  label: string
  icon: LucideIcon
}

/**
 * Props every top-level page receives from the shell.
 *
 * Pages that need nothing from the shell simply declare no parameters — but
 * declaring the contract once keeps in-page links (for example the dashboard
 * linking into Notes and Tasks) type-checked.
 */
export type PageProps = {
  /** Switches the active view. */
  onNavigate: (view: ViewId) => void
}

/**
 * A one-shot request that travels with a navigation, for actions that mean
 * "go there *and* do something". Recorded with `requestIntent` before
 * navigating and picked up once by the destination view.
 *
 * The `create-*` variants carry no payload — the destination has nothing to
 * look up. The `open-*` variants come from workspace search and name the exact
 * record to reveal, so a result opens the item it matched instead of merely
 * landing on its workspace. `search-archive` is the archive's equivalent: it
 * carries the text to prefill the archive's own search with.
 */
export type ViewIntent =
  | { type: 'create-note' }
  | { type: 'create-task' }
  | { type: 'create-snippet' }
  | { type: 'open-note'; id: string }
  | { type: 'open-task'; id: string }
  | { type: 'open-snippet'; id: string }
  | { type: 'search-archive'; query: string }
