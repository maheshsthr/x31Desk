/**
 * Builds the Electron main process and the sandboxed preload.
 * ---------------------------------------------------------------------------
 * The shell's sources are TypeScript. Electron loads JavaScript, and the
 * sandboxed preload cannot be an ES module, so both entry points are bundled
 * here — with the Vite already in the project, so no tool is added.
 *
 * Two separate bundles, because the two outputs need different module formats
 * and Vite's library mode can only emit one format per build:
 *
 *   electron/main.ts    → electron/dist/main.mjs    (ES module, kept ESM)
 *   electron/preload.ts → electron/dist/preload.cjs (CommonJS, sandboxed)
 *
 * `electron` and every `node:` built-in stay external (Electron provides them),
 * while anything else — including the shared IPC contract imported through the
 * `@` alias — is inlined. The output directory is gitignored and rebuilt by
 * `npm run build`, `npm start` and the dev launcher.
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(projectRoot, 'electron/dist')

/** Electron and Node built-ins are provided at runtime and are never bundled. */
const external = ['electron', /^node:/]

/**
 * Bundles one entry to one file. `emptyOutDir` is set only for the first build
 * so the second does not wipe the first's output.
 */
async function bundle(entry, fileName, format, emptyOutDir) {
  await build({
    configFile: false,
    envDir: false,
    root: projectRoot,
    publicDir: false,
    logLevel: 'warn',
    resolve: {
      alias: {
        '@': resolve(projectRoot, 'src'),
      },
    },
    build: {
      outDir,
      emptyOutDir,
      minify: false,
      sourcemap: false,
      reportCompressedSize: false,
      target: 'node24',
      rollupOptions: {
        input: resolve(projectRoot, entry),
        external,
        output: {
          format,
          entryFileNames: fileName,
          // One entry, one file: there is never a shared chunk to split out.
          codeSplitting: false,
        },
      },
    },
  })
}

await bundle('electron/main.ts', 'main.mjs', 'es', true)
await bundle('electron/preload.ts', 'preload.cjs', 'cjs', false)

console.log('[x31desk] electron bundles written to electron/dist')
