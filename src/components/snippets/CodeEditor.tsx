import { closeBrackets } from '@codemirror/autocomplete'
import { history } from '@codemirror/commands'
import { bracketMatching, indentUnit } from '@codemirror/language'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { tokyoNight } from '@uiw/codemirror-theme-tokyo-night'
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder,
} from '@codemirror/view'
import { useEffect, useRef, useState } from 'react'

import { INDENT_UNIT, codeEditingKeymap } from '@/components/snippets/codeEditing'
import { codeLanguageExtension } from '@/components/snippets/codeLanguage'
import { useEditorPreferences } from '@/hooks/useEditorPreferences'
import type { EditorPreferences } from '@/types/editorPreferences'
import type { SnippetLanguage } from '@/types/snippet'
import { cn } from '@/utils/cn'

type CodeEditorProps = {
  /** The code to show. Applied to the document only when it changes elsewhere. */
  value: string
  language: SnippetLanguage
  /** Called with the full document after every edit. */
  onChange: (value: string) => void
  /** Accessible name of the editing surface. */
  label: string
  /** Flags the code as missing, mirroring a form field's `aria-invalid`. */
  invalid?: boolean
  className?: string
}

/** Shown while the code is empty, matching the field it replaced. */
const CODE_PLACEHOLDER = 'Paste or type the snippet here.'

const FONT_WEIGHT_TOKENS: Record<EditorPreferences['fontWeight'], string> = {
  normal: 'var(--x31-font-weight-regular)',
  medium: 'var(--x31-font-weight-medium)',
  semibold: 'var(--x31-font-weight-semibold)',
}

/**
 * Attributes for the editing surface. CodeMirror already marks it as a
 * multiline textbox; these add the name the old `<textarea>` carried and the
 * spell-check suppression code fields want.
 */
function surfaceAttributes(label: string, invalid: boolean) {
  return EditorView.contentAttributes.of({
    'aria-label': label,
    'aria-invalid': invalid ? 'true' : 'false',
    spellcheck: 'false',
    autocapitalize: 'off',
    autocomplete: 'off',
  })
}

/**
 * x31Desk's own layer over Tokyo Night so the editor belongs in the app: it
 * fills its pane, scrolls internally, uses the app's monospace stack, and paints
 * bracket matching in Tokyo Night colours — the theme package styles everything
 * else, but not brackets.
 *
 * The text size and weight are *not* set here: they come from the user's editor
 * preferences through {@link editorPreferenceExtensions}, so this layer stays
 * the stable half and only the preference half is reconfigured.
 *
 * Tokyo Night is a dark theme, so the code surface stays dark in both
 * application themes — a dark code surface inside a themed shell is the
 * intended look, not an oversight.
 */
const editorTheme = EditorView.theme({
  '&': { height: '100%' },
  '.cm-scroller': {
    fontFamily: 'var(--x31-font-mono)',
    lineHeight: 'var(--x31-line-height-relaxed)',
    overflow: 'auto',
  },
  '.cm-content': { padding: '0.75rem 0' },
  '.cm-line': { padding: '0 1rem' },
  '.cm-gutters': { border: 'none' },
  '.cm-placeholder': { color: 'var(--x31-color-text-muted)', fontStyle: 'normal' },
  // Tokyo Night's bracket pair highlight: a soft selection blue for a match,
  // Tokyo Night red for a mismatch.
  '&.cm-focused .cm-matchingBracket': {
    backgroundColor: '#3d59a166',
    outline: '1px solid #545c7e',
  },
  '&.cm-focused .cm-nonmatchingBracket': {
    backgroundColor: '#f7768e33',
    outline: '1px solid #f7768e',
  },
})

/**
 * The parts of the editor the Settings page controls: text size and weight plus
 * the three decorations. Rebuilt from preferences and swapped through a
 * compartment, so a change reconfigures the running editor in place instead of
 * recreating it — the document, selection and undo history all survive.
 */
function editorPreferenceExtensions(preferences: EditorPreferences): Extension {
  const extensions: Extension[] = [
    EditorView.theme({
      // The preference is the pixel size exactly as chosen — no intermediate
      // multiplier sits between the setting and the rendered code.
      '&': { fontSize: `${preferences.fontSize}px` },
      '.cm-scroller': { fontWeight: FONT_WEIGHT_TOKENS[preferences.fontWeight] },
    }),
    preferences.lineNumbers ? lineNumbers() : [],
    preferences.activeLine ? [highlightActiveLine(), highlightActiveLineGutter()] : [],
    preferences.bracketMatching ? bracketMatching() : [],
  ]

  return extensions
}

/**
 * Everything the editor does that never changes with the snippet or with the
 * user's preferences: undo history, selection drawing, the keymap and the Tokyo
 * Night theme. Shared by every instance — CodeMirror extensions are values, not
 * state.
 */
const BASE_EXTENSIONS: readonly Extension[] = [
  highlightSpecialChars(),
  history(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentUnit.of(INDENT_UNIT),
  closeBrackets(),
  EditorView.lineWrapping,
  placeholder(CODE_PLACEHOLDER),
  tokyoNight,
  editorTheme,
  keymap.of(codeEditingKeymap),
]

/**
 * The editor's one-time configuration, fixed on the first render: the values it
 * opens with and the compartments that let its language, surface attributes and
 * preference-driven extensions be swapped afterwards without rebuilding it.
 */
type EditorSetup = {
  /** Slot holding the syntax parser, so the language can change in place. */
  language: Compartment
  /** Slot holding the surface attributes, for label and validity changes. */
  attributes: Compartment
  /** Slot holding the preference-driven extensions, for live settings changes. */
  preferences: Compartment
  doc: string
  /** Language the document opens parsed as. */
  initialLanguage: SnippetLanguage
  initialLabel: string
  initialInvalid: boolean
  initialPreferences: EditorPreferences
}

/**
 * CodeMirror 6 as a controlled field.
 *
 * The view is created once and then driven imperatively: typing flows out
 * through `onChange`, and the `value` prop only reaches the document when it
 * differs, so React re-renders never rebuild the editor or move the caret.
 * `onChange` is read through a ref so that even a freshly-created callback from
 * the parent is always the one invoked.
 *
 * The parent remounts this component (via `key`) when a different snippet is
 * opened, which is why the document is seeded from `value` at creation time.
 */
export function CodeEditor({
  value,
  language,
  onChange,
  label,
  invalid = false,
  className,
}: CodeEditorProps) {
  const preferences = useEditorPreferences()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)

  const [setup] = useState<EditorSetup>(() => ({
    language: new Compartment(),
    attributes: new Compartment(),
    preferences: new Compartment(),
    doc: value,
    initialLanguage: language,
    initialLabel: label,
    initialInvalid: invalid,
    initialPreferences: preferences,
  }))

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    const host = hostRef.current

    if (!host) {
      return
    }

    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: setup.doc,
        extensions: [
          ...BASE_EXTENSIONS,
          setup.preferences.of(editorPreferenceExtensions(setup.initialPreferences)),
          setup.language.of(codeLanguageExtension(setup.initialLanguage)),
          setup.attributes.of(surfaceAttributes(setup.initialLabel, setup.initialInvalid)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString())
            }
          }),
        ],
      }),
    })

    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [setup])

  // Accept a document written from the outside without touching its own edits.
  useEffect(() => {
    const view = viewRef.current

    if (!view) {
      return
    }

    const current = view.state.doc.toString()

    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
    }
  }, [value])

  // Re-parse with the newly chosen language, keeping the document and caret.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: setup.language.reconfigure(codeLanguageExtension(language)),
    })
  }, [setup, language])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: setup.attributes.reconfigure(surfaceAttributes(label, invalid)),
    })
  }, [setup, label, invalid])

  // Apply editor preference changes live; the view itself is never rebuilt.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: setup.preferences.reconfigure(editorPreferenceExtensions(preferences)),
    })
  }, [setup, preferences])

  return <div ref={hostRef} className={cn('min-h-0 overflow-hidden', className)} />
}
