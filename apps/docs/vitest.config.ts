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
      // Deep imports from the preload (e.g. @genoffice/renderer-bridge/bridges/docs-bridge)
      // are used to avoid pulling in the slides bridge, which imports
      // @genoffice/slides-shared (whose `declare global { Window.desktop }`
      // would conflict with the docs DesktopApi).
      // The regex matches:
      //   @genoffice/renderer-bridge           → src/index.ts (barrel)
      //   @genoffice/renderer-bridge/foo/bar   → src/foo/bar.ts (deep)
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
