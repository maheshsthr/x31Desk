import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { java } from '@codemirror/lang-java'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { php } from '@codemirror/lang-php'
import { python } from '@codemirror/lang-python'
import { sql } from '@codemirror/lang-sql'
import { StreamLanguage } from '@codemirror/language'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import type { Extension } from '@codemirror/state'

import type { SnippetLanguage } from '@/types/snippet'

/**
 * The CodeMirror parser behind each snippet language.
 *
 * An exhaustive record of {@link SnippetLanguage}: adding a language to the
 * workspace without deciding how it is parsed is a compile error, exactly as
 * `LANGUAGE_LABELS` guards the selector.
 *
 * Plain Text maps to an empty extension on purpose — it has no grammar, so the
 * editor shows it unstyled instead of guessing.
 */
const LANGUAGE_SUPPORT: Record<SnippetLanguage, Extension> = {
  javascript: javascript(),
  typescript: javascript({ typescript: true }),
  html: html(),
  css: css(),
  python: python(),
  java: java(),
  php: php(),
  sql: sql(),
  json: json(),
  // Bash has no Lezer grammar in CodeMirror; the maintained shell legacy mode
  // is the way to colour it.
  bash: StreamLanguage.define(shell),
  plaintext: [],
}

/** The language parser for a snippet language, as a configurable extension. */
export function codeLanguageExtension(language: SnippetLanguage): Extension {
  return LANGUAGE_SUPPORT[language]
}
