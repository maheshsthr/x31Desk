/// <reference types="vite/client" />

/**
 * Application version, injected at build time from package.json by the `define`
 * block in `vite.config.ts`. Declared here so the About section can read it with
 * a proper type instead of a cast.
 */
declare const __APP_VERSION__: string
