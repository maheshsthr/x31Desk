/**
 * Development launcher for the Electron shell.
 * ---------------------------------------------------------------------------
 * `npm run dev:electron` runs this file. It starts the *existing* Vite dev
 * server through Vite's Node API, waits until it reports a URL, then launches
 * Electron pointed at that URL through `X31DESK_DEV_SERVER_URL`. The web-only
 * workflow (`npm run dev`) is untouched.
 *
 * Using the Node API rather than shelling out to `vite` and parsing its output
 * removes the start-up race: the Electron window opens only once the server is
 * genuinely listening. No extra dependencies are needed for either step.
 *
 * The dev server and Electron are tied together — closing the window shuts the
 * server down, and Ctrl+C closes both — so a stray server is never left behind.
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// The `electron` package's main export is the absolute path to its executable;
// requiring it here is how a Node script finds the binary to launch.
const require = createRequire(import.meta.url)
const electronExecutable = require('electron')

const server = await createServer({ root: projectRoot })
await server.listen()

const devServerUrl = server.resolvedUrls?.local?.[0]

if (!devServerUrl) {
  await server.close()
  throw new Error('The Vite dev server did not report a local URL to open.')
}

console.log(`[x31desk] Vite dev server ready at ${devServerUrl}`)
console.log('[x31desk] launching Electron...')

const electron = spawn(electronExecutable, [projectRoot], {
  stdio: 'inherit',
  env: { ...process.env, X31DESK_DEV_SERVER_URL: devServerUrl },
})

let shuttingDown = false

async function shutdown(exitCode) {
  if (shuttingDown) {
    return
  }

  shuttingDown = true
  await server.close()
  process.exit(exitCode)
}

electron.on('exit', (code) => {
  void shutdown(code ?? 0)
})

electron.on('error', (error) => {
  console.error('[x31desk] failed to start Electron:', error)
  void shutdown(1)
})

// Ctrl+C on the launcher tears the child down first; its `exit` handler then
// closes the server and ends this process.
process.on('SIGINT', () => {
  electron.kill()
})

process.on('SIGTERM', () => {
  electron.kill()
})
