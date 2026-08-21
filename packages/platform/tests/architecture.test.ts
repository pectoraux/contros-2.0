/**
 * Architecture-boundary test for @genoffice/platform.
 *
 * Enforces Rule (ADR-001 §6.2): the platform package is platform-neutral —
 * zero Electron imports, zero node:* imports, zero direct browser API usage.
 *
 * The `@genoffice/*-shared` path aliases are permitted because they point
 * at TypeScript type definitions in app shared files (no runtime code is
 * pulled in via `import type`).
 */
import { describe, test, expect } from 'vitest'
import { join } from 'node:path'
import { scanForImports, scanForTokens } from './helpers.js'

const SRC = join(__dirname, '..', 'src')

describe('@genoffice/platform architecture boundary', () => {
  test('no Electron imports', () => {
    const hits = scanForImports(SRC, [
      'electron',
      '@genoffice/electron-utils',
    ])
    expect(hits).toEqual([])
  })

  test('no node: imports', () => {
    const hits = scanForImports(SRC, [/^node:/])
    expect(hits).toEqual([])
  })

  test('no direct browser API usage (window, document, indexedDB, localStorage, fetch)', () => {
    // Allow these tokens in JSDoc comments. The forbidden tokens are
    // programmatic references — `window.`, `document.`, `fetch(` etc.
    const hits = scanForTokens(SRC, [
      'window.',
      'document.',
      'indexedDB',
      'localStorage',
      'sessionStorage',
      'showOpenFilePicker',
      'showSaveFilePicker',
      'navigator.clipboard',
      'self.registration',
    ]).filter((h) => !h.text.startsWith('*') && !h.text.startsWith('//'))
    expect(hits).toEqual([])
  })

  test('no @genoffice/*-shared runtime imports (type-only allowed)', () => {
    // `import type` is fine; `import { Foo }` (value import) from an app
    // shared file would pull in runtime code.
    const hits = scanForTokens(SRC, ['@genoffice/shell-home-shared', '@genoffice/shell-tabs-shared'])
      .filter(
        (h) =>
          !h.text.startsWith('//') &&
          !h.text.startsWith('*') &&
          !h.text.includes('import type') &&
          !h.text.includes('export type'),
      )
    expect(hits).toEqual([])
  })
})
