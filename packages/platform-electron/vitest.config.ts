import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: false,
  },
  resolve: {
    alias: {
      // Path aliases mirroring tsconfig.base.json — the gateway modules
      // live in apps/sheets/src/gateway/ and are imported by platform-electron's
      // save-plan-translator (Increment 3D). These are the AUTHORITATIVE
      // planning implementations; the translator does NOT reinvent XLSX mutation.
      '@genoffice/xlsx-gateway': resolve(root, 'apps/sheets/src/gateway/xlsx-gateway.ts'),
      '@genoffice/xlsx-sheets': resolve(root, 'apps/sheets/src/gateway/xlsx-sheets.ts'),
      '@genoffice/xlsx-structure': resolve(root, 'apps/sheets/src/gateway/xlsx-structure.ts'),
      '@genoffice/xlsx-filter': resolve(root, 'apps/sheets/src/gateway/xlsx-filter.ts'),
      '@genoffice/xlsx-defined-names': resolve(root, 'apps/sheets/src/gateway/xlsx-defined-names.ts'),
      '@genoffice/xlsx-page-setup': resolve(root, 'apps/sheets/src/gateway/xlsx-page-setup.ts'),
      '@genoffice/xlsx-theme': resolve(root, 'apps/sheets/src/gateway/xlsx-theme.ts'),
      '@genoffice/xlsx-package-io': resolve(root, 'apps/sheets/src/gateway/xlsx-package-io.ts'),
    },
  },
})
