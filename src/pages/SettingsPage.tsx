import { Code2, HardDrive, Info, Keyboard, Moon, Palette, Trash2 } from 'lucide-react'
import { Fragment, useState } from 'react'

import { BrandMark } from '@/components/branding/BrandMark'
import { BackupData } from '@/components/settings/BackupData'
import { FieldRow } from '@/components/settings/FieldRow'
import { SettingsNav } from '@/components/settings/SettingsNav'
import { SettingsSection } from '@/components/settings/SettingsSection'
import { ToggleRow } from '@/components/settings/ToggleRow'
import { UnreadableDataRow } from '@/components/settings/UnreadableDataRow'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Kbd } from '@/components/ui/Kbd'
import { PageHeader } from '@/components/ui/PageHeader'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Select } from '@/components/ui/Select'
import { hasRecovery } from '@/data/recovery'
import { getLastStorageErrorKind, storageErrorMessage } from '@/data/storageError'
import { clearWorkspaceData } from '@/data/workspaceReset'
import { useRecoveryData } from '@/hooks/useRecoveryData'
import { useSettings } from '@/hooks/useSettings'
import { useToast } from '@/hooks/useToast'
import { SHORTCUTS, SHORTCUT_GROUPS, formatBinding } from '@/shortcuts/shortcuts'
import {
  EDITOR_FONT_SIZES,
  EDITOR_FONT_WEIGHTS,
  type EditorFontWeight,
} from '@/types/editorPreferences'
import type { ThemePreference } from '@/types/theme'

/** Mirrors `description` in package.json; shown without the product-name prefix. */
const PRODUCT_DESCRIPTION =
  'An easy to use personal desktop workspace for notes, tasks and focused work.'

const THEME_OPTIONS: readonly { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
]

/** Select values are strings; the preference itself is a number of pixels. */
const FONT_SIZE_OPTIONS = EDITOR_FONT_SIZES.map((size) => ({
  value: String(size),
  label: `${size} px`,
}))

const SECTIONS = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'editor', label: 'Code Editor', icon: Code2 },
  { id: 'workspace', label: 'Workspace', icon: HardDrive },
  { id: 'shortcuts', label: 'Keyboard Shortcuts', icon: Keyboard },
  { id: 'about', label: 'About', icon: Info },
]

/**
 * The settings workspace: appearance, code editor, keyboard shortcuts, local
 * data and product information.
 *
 * Everything here is backed by the shared settings store, so changes take
 * effect immediately and survive a refresh. The one data action — clearing the
 * workspace — goes through the repositories rather than touching
 * `localStorage` here, and never touches a preference. The shortcut list is
 * read from the registry itself, so it documents the bindings that actually
 * fire rather than a copy of them.
 */
export function SettingsPage() {
  const { notify } = useToast()
  const { themePreference, resolvedTheme, editor, setThemePreference, updateEditorPreferences } =
    useSettings()
  const [isConfirmingClear, setIsConfirmingClear] = useState(false)
  // Read once on mount, then re-read after a clear — the only action here that
  // can change what is recoverable. The desktop archive vault is folded in
  // asynchronously by the hook.
  const { snapshot, reload: reloadRecovery } = useRecoveryData()

  const themeDescription =
    themePreference === 'system'
      ? `Following your operating system — currently ${resolvedTheme}.`
      : 'Light, dark, or match your operating system.'

  const hasRecoverableData = hasRecovery(snapshot)
  // The desktop shell binds the SQLite store; everywhere else the workspace is
  // in the browser's own storage. Reported rather than assumed, so the panel
  // says where the data actually is.
  const isDesktop = window.x31deskDesktop !== undefined

  const confirmClear = () => {
    setIsConfirmingClear(false)

    void clearWorkspaceData().then((cleared) => {
      void reloadRecovery()
      notify(
        cleared
          ? 'All workspace data cleared.'
          : storageErrorMessage(
              getLastStorageErrorKind(),
              'Some workspace data could not be cleared.',
            ),
      )
    })
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description="Appearance, the code editor, keyboard shortcuts, local data and product information."
      />

      {/*
        The section rail and the settings column share one breakpoint.
        `SettingsNav` turns vertical and sticky at `lg`, so this grid switches to
        its two-column form at exactly the same width. When the two disagree the
        horizontal rail is squeezed into the 11rem track and its wrapped items
        crowd the section they are meant to navigate.
      */}
      <div className="mt-6 grid gap-8 lg:grid-cols-[11rem_minmax(0,1fr)]">
        <SettingsNav sections={SECTIONS} />

        <div className="flex min-w-0 flex-col gap-8">
          <SettingsSection
            id="appearance"
            title="Appearance"
            description="How the workspace is painted and sized."
            icon={Palette}
          >
            <FieldRow title="Theme" description={themeDescription}>
              <SegmentedControl
                label="Theme"
                options={THEME_OPTIONS}
                value={themePreference}
                onChange={setThemePreference}
              />
            </FieldRow>
          </SettingsSection>

          <SettingsSection
            id="editor"
            title="Code Editor"
            description="Applied to the snippets editor."
            icon={Code2}
          >
            <FieldRow title="Editor font size" description="Code text size, from 12 to 20 pixels.">
              <Select
                label="Editor font size"
                options={FONT_SIZE_OPTIONS}
                value={String(editor.fontSize)}
                onChange={(value) => updateEditorPreferences({ fontSize: Number(value) })}
                className="w-28"
              />
            </FieldRow>

            <FieldRow title="Editor font weight" description="JetBrains Mono weight used for code.">
              <SegmentedControl
                label="Editor font weight"
                options={EDITOR_FONT_WEIGHTS}
                value={editor.fontWeight}
                onChange={(value: EditorFontWeight) => updateEditorPreferences({ fontWeight: value })}
              />
            </FieldRow>

            <ToggleRow
              title="Line numbers"
              description="Show the line-number gutter beside the code."
              checked={editor.lineNumbers}
              onChange={(checked) => updateEditorPreferences({ lineNumbers: checked })}
            />

            <ToggleRow
              title="Active line highlight"
              description="Highlight the line the cursor is on."
              checked={editor.activeLine}
              onChange={(checked) => updateEditorPreferences({ activeLine: checked })}
            />

            <ToggleRow
              title="Bracket matching"
              description="Highlight the bracket pair around the cursor."
              checked={editor.bracketMatching}
              onChange={(checked) => updateEditorPreferences({ bracketMatching: checked })}
            />

            <FieldRow title="Editor theme" description="The editor ships with a single theme.">
              <span className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line bg-canvas px-2.5 text-sm font-medium text-ink">
                <Moon aria-hidden className="size-3.5 text-accent" strokeWidth={1.9} />
                Tokyo Night
              </span>
            </FieldRow>
          </SettingsSection>

          <SettingsSection
            id="workspace"
            title="Workspace"
            description="Where your work is kept."
            icon={HardDrive}
          >
            <FieldRow
              title="Storage"
              description={
                isDesktop
                  ? 'Everything is kept in a local SQLite database on this device. No data leaves it.'
                  : "Everything is kept in this browser's local storage."
              }
            >
              <span className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line bg-canvas px-2.5 text-sm font-medium text-ink">
                <HardDrive aria-hidden className="size-3.5 text-accent" strokeWidth={1.9} />
                {isDesktop ? 'SQLite database' : 'Local browser storage'}
              </span>
            </FieldRow>

            <BackupData isDesktop={isDesktop} />

            {hasRecoverableData ? (
              <UnreadableDataRow snapshot={snapshot} onReload={reloadRecovery} />
            ) : null}

            <FieldRow
              title="Clear all workspace data"
              description="Permanently delete every note, task, snippet and archived item on this device. Your preferences are kept."
            >
              <Button variant="danger" icon={Trash2} onClick={() => setIsConfirmingClear(true)}>
                Clear data
              </Button>
            </FieldRow>
          </SettingsSection>

          <SettingsSection
            id="shortcuts"
            title="Keyboard Shortcuts"
            description="Everything you can do without reaching for the mouse."
            icon={Keyboard}
          >
            {/*
              Rendered from the registry the dispatcher itself reads, so a
              listed combination is by construction the one that fires. Rows
              follow `FieldRow`'s geometry (px-4 py-3, action on the left,
              keys on the trailing edge) to keep the page's rhythm.
            */}
            {SHORTCUT_GROUPS.map((group) => (
              <Fragment key={group}>
                <p className="px-4 pt-3 pb-1 text-2xs font-semibold tracking-wide text-ink-muted uppercase">
                  {group}
                </p>

                {SHORTCUTS.filter((shortcut) => shortcut.group === group).map((shortcut) => (
                  <div
                    key={shortcut.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <p className="text-sm font-medium text-ink">{shortcut.label}</p>

                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                      {shortcut.bindings.map((binding) => (
                        <Kbd key={formatBinding(binding)}>{formatBinding(binding)}</Kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </Fragment>
            ))}
          </SettingsSection>

          <SettingsSection id="about" title="About" description="What this application is." icon={Info}>
            <div className="flex flex-col gap-4 px-4 py-4">
              <div className="flex items-center gap-3">
                <BrandMark variant="full" size={64} />
                <p className="text-xs text-ink-muted">Version {__APP_VERSION__}</p>
              </div>
              <p className="max-w-prose text-xs text-ink-muted">{PRODUCT_DESCRIPTION}</p>
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium text-ink">Connect with the Developer</p>
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href="https://www.linkedin.com/in/msx31/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line bg-canvas px-2.5 text-xs text-ink transition-colors hover:bg-nav-hover"
                  >
                    <svg
                      aria-hidden
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      className="size-3.5"
                    >
                      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
                      <rect width="4" height="12" x="2" y="9" />
                      <circle cx="4" cy="4" r="2" />
                    </svg>
                    LinkedIn
                  </a>
                  <a
                    href="https://github.com/maheshsthr"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line bg-canvas px-2.5 text-xs text-ink transition-colors hover:bg-nav-hover"
                  >
                    <svg
                      aria-hidden
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      className="size-3.5"
                    >
                      <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
                      <path d="M9 18c-4.51 2-5-2-7-2" />
                    </svg>
                    GitHub
                  </a>
                </div>
              </div>
            </div>
          </SettingsSection>
        </div>
      </div>

      <ConfirmDialog
        open={isConfirmingClear}
        title="Clear all workspace data?"
        description={
          hasRecoverableData
            ? 'This permanently deletes every note, task, snippet and archived item on this device, including the unreadable data kept for recovery. It cannot be undone. Your theme and editor preferences are kept.'
            : 'This permanently deletes every note, task, snippet and archived item on this device. It cannot be undone. Your theme and editor preferences are kept.'
        }
        confirmLabel="Clear all data"
        destructive
        onConfirm={confirmClear}
        onCancel={() => setIsConfirmingClear(false)}
      />
    </>
  )
}
