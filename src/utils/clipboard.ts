/**
 * Copies text to the system clipboard.
 *
 * The asynchronous Clipboard API is preferred, but it is unavailable outside a
 * secure context and can reject when the document is not focused, so a hidden
 * textarea plus `execCommand` covers the rest. Resolving with whether the text
 * actually made it is deliberate: it is what lets the caller report a real
 * failure instead of claiming a copy that never happened.
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text)

      return true
    }
  } catch {
    // Denied or unfocused: fall through to the legacy path below.
  }

  return copyWithExecCommand(text)
}

/**
 * Last-resort copy for engines without the async Clipboard API. Deprecated, but
 * it still works everywhere and is the only option when `navigator.clipboard`
 * is missing.
 */
function copyWithExecCommand(text: string): boolean {
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.top = '-1000px'
    area.style.opacity = '0'
    document.body.appendChild(area)

    area.select()
    const copied = document.execCommand('copy')

    document.body.removeChild(area)

    return copied
  } catch {
    return false
  }
}
