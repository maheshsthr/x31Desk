/**
 * Triggers a browser download of a text file.
 *
 * A Blob behind an object URL on a temporary anchor is the portable way to save
 * generated content without a server. The object URL is released on the next
 * task rather than synchronously, because revoking it in the same tick can
 * cancel the download in some engines.
 *
 * Resolves with whether the download could be *started*: constructing the Blob,
 * object URL or anchor can all throw in a hardened browser, and the caller
 * reports a real failure instead of claiming a file that never appeared.
 */
export function downloadTextFile(
  filename: string,
  contents: string,
  mimeType = 'application/json',
): boolean {
  let url: string | null = null

  try {
    url = URL.createObjectURL(new Blob([contents], { type: mimeType }))

    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.rel = 'noopener'
    anchor.style.display = 'none'

    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()

    return true
  } catch {
    return false
  } finally {
    if (url !== null) {
      const released = url
      window.setTimeout(() => URL.revokeObjectURL(released), 0)
    }
  }
}
