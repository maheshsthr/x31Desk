// The official-brand wiring, pinned at the source.
// ---------------------------------------------------------------------------
// The product logo is supplied as `transparent.png` — a 500x500 PNG with an
// alpha channel, the symbol above the "x31Desk" wordmark on a transparent
// background — and `scripts/make-logo-assets.ps1` derives two square assets
// from it. Every branded surface renders those assets through the single
// `BrandMark` component. Three regressions are silent and worth pinning:
//
//   * the wordmark being rebuilt as markup or text instead of the artwork,
//   * a retired logo file being reintroduced, and
//   * a branded surface growing its own logo instead of using the component.
//
// The assets are binary, so this checks structure (which files exist, what the
// component imports, whether alpha survived) rather than pixels.
// Dependency-free: Node's built-in test runner and type stripping.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

const at = (relative: string) => new URL(relative, import.meta.url)

test('the derived logo assets exist and the retired ones are gone', () => {
  assert.ok(existsSync(at('../src/assets/x31desk-logo.png')), 'the full lockup asset should exist')
  assert.ok(existsSync(at('../src/assets/x31desk-mark.png')), 'the symbol-only asset should exist')

  assert.equal(
    existsSync(at('../src/assets/x31desk-mark.svg')),
    false,
    'the retired hand-drawn SVG mark should be gone',
  )
  assert.equal(
    existsSync(at('../public/favicon.svg')),
    false,
    'the retired hand-drawn SVG favicon should be gone',
  )
})

test('the derived assets keep the artwork’s transparency', () => {
  // IHDR colour type lives at byte 25: 2 is RGB (opaque), 6 is RGBA. Both
  // assets are composed on the artwork's own alpha channel, so flattening them
  // would put a box back around the logo wherever the surface is not white.
  const colorType = (file: string) => readFileSync(at(file))[25]

  assert.equal(colorType('../src/assets/x31desk-logo.png'), 6, 'the lockup should keep its alpha channel')
  assert.equal(colorType('../src/assets/x31desk-mark.png'), 6, 'the symbol should keep its alpha channel')
})

test('BrandMark renders the official artwork, never a text wordmark', () => {
  const source = readFileSync(at('../src/components/branding/BrandMark.tsx'), 'utf8')

  assert.match(source, /@\/assets\/x31desk-logo\.png/, 'the full variant should use the lockup')
  assert.match(source, /@\/assets\/x31desk-mark\.png/, 'the mark variant should use the symbol')
  assert.match(source, /alt="x31Desk"/, 'the logo image needs meaningful alt text')

  // The wordmark is part of the artwork now, so the component must not spell it
  // out as styled text.
  assert.doesNotMatch(source, /x31<span/, 'the wordmark should not be rebuilt as markup')
})

test('every branded surface goes through the one component', () => {
  const surfaces = [
    '../src/components/titlebar/TitleBar.tsx',
    '../src/components/startup/StartupSplash.tsx',
    '../src/components/startup/StorageFailureScreen.tsx',
    '../src/pages/SettingsPage.tsx',
  ]

  for (const surface of surfaces) {
    const source = readFileSync(at(surface), 'utf8')

    assert.match(source, /<BrandMark\b/, `${surface} should render the shared BrandMark`)
    // No surface may import a logo asset or an inline SVG of its own.
    assert.doesNotMatch(source, /x31desk-(logo|mark)\.(png|svg)/, `${surface} should not import a logo directly`)
  }
})

test('the favicon points at the bundled mark, not the retired SVG', () => {
  const html = readFileSync(at('../index.html'), 'utf8')

  assert.match(html, /rel="icon"[^>]*x31desk-mark\.png/, 'the favicon should be the official mark')
  assert.doesNotMatch(html, /favicon\.svg/, 'the retired favicon should not be referenced')
})
