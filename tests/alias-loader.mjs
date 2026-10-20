// Resolves the application's `@/` path alias (see `vite.config.ts` and
// `tsconfig.app.json`) for Node's test runner, so the data layer can be imported
// under `node --test` exactly as the app imports it.
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const srcRoot = new URL('../src/', import.meta.url)

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const base = new URL(specifier.slice(2), srcRoot)
    const candidates = [`${base.href}.ts`, `${base.href}/index.ts`, base.href]

    for (const candidate of candidates) {
      if (existsSync(fileURLToPath(candidate))) {
        return nextResolve(candidate, context)
      }
    }
  }

  return nextResolve(specifier, context)
}
