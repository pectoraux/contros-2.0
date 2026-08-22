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
  { find: /^@genoffice\/renderer-bridge\/docs$/, replacement: resolve(rendererBridgeSrc, 'docs-entry.ts') },
  { find: /^@genoffice\/renderer-bridge\/(.+)$/, replacement: resolve(rendererBridgeSrc, '$1') },
  { find: /^@genoffice\/renderer-bridge$/, replacement: resolve(rendererBridgeSrc, 'index.ts') },
]

export default defineConfig({
  // Main and preload use only electron + node builtins; bundle everything so
  // the packaged app doesn't rely on node_modules at runtime.
  // @genoffice/* workspace packages ship TS source (no build step, no
  // compiled entry point) — externalizing them makes Node's ESM loader try
  // to resolve their relative imports at runtime and fail (ERR_MODULE_NOT_FOUND
  // on extensionless .js imports like `./capabilities/electron-storage.js`).
  // Bundle ALL @genoffice/* deps; externalize everything else (Electron, zod,
  // node builtins, pdf-lib, etc.). This mirrors the pattern in apps/sheets.
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          '@genoffice/electron-utils',
          '@genoffice/font-metrics',
          '@genoffice/platform-electron',
          '@genoffice/runtime-contracts',
          '@genoffice/services-docs',
          '@genoffice/ai-provider',
          '@genoffice/ai-search',
          '@genoffice/agent-core',
          '@genoffice/docx-engine',
          '@genoffice/file-parse',
          '@genoffice/i18n',
          '@genoffice/project-store',
          '@genoffice/pptx-render',
          '@genoffice/ui',
        ],
      }),
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
