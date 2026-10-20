import { closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, historyKeymap, indentLess, indentMore } from '@codemirror/commands'
import { EditorSelection, type StateCommand } from '@codemirror/state'
import type { KeyBinding } from '@codemirror/view'

/** One indentation level. Four spaces, matching the app's code style. */
export const INDENT_UNIT = '    '

/** Each opening bracket and the closer that matches it. */
const BRACKET_PAIRS: Readonly<Record<string, string>> = { '{': '}', '[': ']', '(': ')' }

/** The leading whitespace of a line, kept verbatim so pasted tabs survive. */
function indentationOf(text: string): string {
  return /^[ \t]*/.exec(text)?.[0] ?? ''
}

/** Whether `text`, ignoring trailing blanks, ends with an opening bracket. */
function opensBlock(text: string): boolean {
  const last = text.replace(/[ \t]+$/, '').slice(-1)

  return last !== '' && BRACKET_PAIRS[last] !== undefined
}

/**
 * Enter, following the indentation rules the snippets editor documents:
 *
 *  - the new line starts at the current line's indentation;
 *  - a line ending in `{`, `[` or `(` gains one more level;
 *  - pressing Enter between a matching pair (`{|}`, `[|]`, `(|)`) opens a block,
 *    drops the closer onto its own line and leaves the caret inside.
 *
 * Only the line being split is touched, and the caret is placed explicitly, so
 * a selection is replaced by the break rather than shifted.
 */
export const insertNewlineAndIndent: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) {
    return false
  }

  const changes = state.changeByRange((range) => {
    const { from, to } = range

    // Pressed exactly between a pair: give the block an inner and an outer line.
    if (from === to && from > 0 && from < state.doc.length) {
      const before = state.doc.sliceString(from - 1, from)
      const after = state.doc.sliceString(from, from + 1)

      if (BRACKET_PAIRS[before] === after) {
        const indent = indentationOf(state.doc.lineAt(from).text)
        const inner = indent + INDENT_UNIT
        const insert = state.lineBreak + inner + state.lineBreak + indent

        return {
          changes: { from, to, insert },
          range: EditorSelection.cursor(from + state.lineBreak.length + inner.length),
        }
      }
    }

    const line = state.doc.lineAt(from)
    const indent = indentationOf(line.text)
    const extra = opensBlock(state.doc.sliceString(line.from, from)) ? INDENT_UNIT : ''
    const insert = state.lineBreak + indent + extra

    return {
      changes: { from, to, insert },
      range: EditorSelection.cursor(from + insert.length),
    }
  })

  dispatch(state.update(changes, { scrollIntoView: true, userEvent: 'input' }))

  return true
}

/**
 * Tab inserts one level at the caret. With a selection it shifts every line the
 * selection touches instead, so a multi-line block moves as one.
 *
 * Shift-Tab is the inverse ({@link indentLess}), which already works line-wise
 * and keeps the selection.
 */
export const insertIndentUnit: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) {
    return false
  }

  if (state.selection.ranges.some((range) => !range.empty)) {
    return indentMore({ state, dispatch })
  }

  dispatch(
    state.update(
      state.changeByRange((range) => ({
        changes: { from: range.from, to: range.to, insert: INDENT_UNIT },
        range: EditorSelection.cursor(range.from + INDENT_UNIT.length),
      })),
      { userEvent: 'input.indent' },
    ),
  )

  return true
}

/**
 * The editor's keymap: the two snippets-specific bindings take precedence over
 * CodeMirror's defaults, and the standard editing, history and bracket-pair
 * bindings are kept so typing, undo and paste behave as expected.
 */
export const codeEditingKeymap: readonly KeyBinding[] = [
  { key: 'Enter', run: insertNewlineAndIndent },
  { key: 'Tab', run: insertIndentUnit, shift: indentLess },
  ...closeBracketsKeymap,
  ...defaultKeymap,
  ...historyKeymap,
]
