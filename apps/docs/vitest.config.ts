import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

const rendererBridgeSrc = resolve(__dirname, '../../packages/renderer-bridge/src')

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'jsdom',
    testTimeout: 20000,
  },
  resolve: {
    alias: [
      // Deep imports from the preload (e.g. @genoffice/renderer-bridge/docs)
      // resolve to the docs-specific entry point, avoiding the slides global
      // declaration. The regex matches:
      //   @genoffice/renderer-bridge/docs  → src/docs-entry.ts
      //   @genoffice/renderer-bridge      → src/index.ts (barrel)
      //   @genoffice/renderer-bridge/foo   → src/foo.ts (deep)
      {
        find: /^@genoffice\/renderer-bridge\/docs$/,
        replacement: resolve(rendererBridgeSrc, 'docs-entry.ts'),
      },
      {
        find: /^@genoffice\/renderer-bridge\/(.+)$/,
        replacement: resolve(rendererBridgeSrc, '$1'),
      },
      {
        find: /^@genoffice\/renderer-bridge$/,
        replacement: resolve(rendererBridgeSrc, 'index.ts'),
      },
    ],
  },
})
