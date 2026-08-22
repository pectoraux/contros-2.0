import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

// Resolve workspace packages from this checkout's sources: in a git worktree
// node_modules is a symlink into the main checkout, so bare specifiers would
// silently bundle the other checkout's (possibly stale) code.
const localAlias = {
  '@genoffice/docx-engine': resolve(__dirname, '../../packages/docx-engine/src/index.ts'),
}

// Increment 3: the preload imports directly from
// @genoffice/renderer-bridge/bridges/docs-bridge (deep import) to avoid
// pulling in the slides bridge, which imports @genoffice/slides-shared
// (whose `declare global { Window.desktop }` conflicts with the docs
// DesktopApi). This alias resolves the deep import at build time.
const rendererBridgeSrc = resolve(__dirname, '../../packages/renderer-bridge/src')
const rendererBridgeAlias = [
  { find: /^@genoffice\/renderer-bridge\/(.+)$/, replacement: resolve(rendererBridgeSrc, '$1') },
  { find: /^@genoffice\/renderer-bridge$/, replacement: resolve(rendererBridgeSrc, 'index.ts') },
]

export default defineConfig({
  // Main and preload use only electron + node builtins; bundle everything so
  // the packaged app doesn't rely on node_modules at runtime.
  // @genoffice/* deps ship as raw TS source with extensionless imports, so they
  // must be bundled — externalizing them yields ERR_MODULE_NOT_FOUND under Node
  // (same setup as apps/slides).
  main: {
    plugins: [
      externalizeDepsPlugin({ exclude: ['@genoffice/electron-utils', '@genoffice/font-metrics'] }),
    ],
    resolve: { alias: localAlias },
  },
  preload: {
    resolve: { alias: [...rendererBridgeAlias, ...Object.entries(localAlias).map(([find, replacement]) => ({ find, replacement }))] },
  },
  renderer: {
    plugins: [react()],
    resolve: { alias: localAlias },
    server: {
      // Overridable so multiple genoffice dev instances can coexist (default 5173).
      port: Number(process.env.DOCS_DEV_PORT) || 5173,
      strictPort: Boolean(process.env.DOCS_DEV_PORT),
    },
  },
})
