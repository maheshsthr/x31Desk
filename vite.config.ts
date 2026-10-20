import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'

// The product version is read from package.json so the About section never has
// to be hand-maintained alongside it.
const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf-8'),
) as { version: string }

/**
 * Injects the renderer's Content-Security-Policy as a `<meta>` tag.
 *
 * The policy is chosen per command rather than weakened for both: the production
 * build — which is also what the Electron shell loads over `file://` — ships the
 * strict policy, while the dev server additionally needs the HMR client's inline
 * preamble and its websocket. Nothing the app legitimately loads is remote, so
 * `'self'` is enough for scripts, styles, fonts, images and connections.
 *
 * `'unsafe-inline'` is required for *styles* in both modes because CodeMirror
 * injects its theme and measurement styles as `<style>` elements at runtime;
 * scripts are never allowed inline in production.
 */
function contentSecurityPolicy(): Plugin {
  const shared = [
    "default-src 'self'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    // `frame-ancestors` is deliberately absent: it only takes effect as an HTTP
    // response header, and Chromium logs an error when it is set in a <meta>.
    "form-action 'none'",
  ]

  const production = [
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "connect-src 'self'",
  ]

  const development = [
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    // The HMR client talks to the dev server over a websocket.
    "connect-src 'self' ws:",
  ]

  return {
    name: 'x31desk:content-security-policy',
    transformIndexHtml: {
      order: 'pre',
      handler(_html, context) {
        const directives = context.server ? development : production

        return [
          {
            tag: 'meta',
            attrs: {
              'http-equiv': 'Content-Security-Policy',
              content: [...directives, ...shared].join('; '),
            },
            injectTo: 'head-prepend',
          },
        ]
      },
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // Relative asset URLs keep the production bundle loadable from a file://
  // protocol, which is what the Electron phase will use.
  base: './',
  plugins: [react(), tailwindcss(), contentSecurityPolicy()],
  define: {
    // Exposed to the application as the `__APP_VERSION__` global; declared in
    // `src/vite-env.d.ts`.
    __APP_VERSION__: JSON.stringify(version),
  },
  // The bundle is read from disk, not downloaded, so the default 500 kB
  // advisory is not meaningful here. The syntax-highlighting languages pulled
  // in by the snippets editor are the bulk of it and are worth their size.
  build: {
    chunkSizeWarningLimit: 1200,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
  },
})
