// Loaded with `--import` before the test files so `@/` resolves. Registered from
// a separate module because `register()` must run before anything imports the
// application source.
import { register } from 'node:module'

register('./alias-loader.mjs', import.meta.url)
