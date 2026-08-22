import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    // @genoffice/* workspace packages ship TS source (no build step, no
    // compiled entry point) — externalizing them makes Node's ESM loader try
    // to resolve their relative imports at runtime and fail (ERR_MODULE_NOT_FOUND
    // on extensionless .js imports like `./capabilities/electron-storage.js`).
    // Bundle ALL @genoffice/* deps; externalize everything else (Electron, zod,
    // node builtins, etc.). This mirrors the pattern in apps/docs.
    //
    // INCREMENT 5B: Added @genoffice/xlsx-gateway (fixes the runtime
    // 'Cannot find module @genoffice/xlsx-gateway/src/gateway/csv-import.js'
    // error — apps/sheets/src/gateway/*.ts re-exports from
    // @genoffice/xlsx-gateway/src/gateway/*.js, which Node cannot resolve
    // without a compile step). Also added @genoffice/platform-electron,
    // @genoffice/runtime-contracts, @genoffice/services-sheets,
    // @genoffice/project-store — same pattern (TS source, no build step),
    // required by the migrated runtime stack introduced in Phase 2.
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          '@genoffice/ai-provider',
          '@genoffice/agent-core',
          '@genoffice/ai-search',
          '@genoffice/docx-engine',
          '@genoffice/file-parse',
          '@genoffice/electron-utils',
          '@genoffice/i18n',
          '@genoffice/xlsx-gateway',
          '@genoffice/platform-electron',
          '@genoffice/runtime-contracts',
          '@genoffice/services-sheets',
          '@genoffice/project-store',
        ],
      }),
    ],
  },
  preload: {
    // Sandboxed preload scripts cannot require arbitrary npm packages at runtime.
    plugins: [],
  },
  renderer: {
    plugins: [react()],
  },
})
