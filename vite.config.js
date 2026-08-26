import { resolve } from 'node:path'
import { overridesApi } from './tools/vite-overrides.mjs'

export default {
  server: { host: '127.0.0.1', port: 5173, open: false },
  // Dev only, by construction: the plugin declares `apply: 'serve'`, so nothing
  // in the built site can write to overrides.json or run a build.
  plugins: [overridesApi()],
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      input: {
        // The game, and the single-building workbench at /building.html.
        main: resolve(process.cwd(), 'index.html'),
        building: resolve(process.cwd(), 'building.html'),
      },
    },
  },
}
