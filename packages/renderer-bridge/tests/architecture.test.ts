/**
 * Architecture-boundary test for @genoffice/renderer-bridge.
 *
 * Enforces:
 * - No Electron imports (ADR-002 Rule 2)
 * - No node: imports
 * - No direct window mutation (ADR-002 §2.3 — the bridge produces objects only)
 * - No ipcRenderer / postMessage / fetch / indexedDB / localStorage
 * - No Proxy (ADR-002 §2.2 — explicit typed method mappings only)
 */
import { describe, test, expect } from 'vitest'
import { join } from 'node:path'
import { scanForImports, scanForTokens } from './helpers/scan.js'

const SRC = join(__dirname, '..', 'src')

describe('@genoffice/renderer-bridge architecture boundary', () => {
  test('no Electron imports', () => {
    const hits = scanForImports(SRC, ['electron', '@genoffice/electron-utils', 'ipcRenderer', 'ipcMain', 'contextBridge'])
    expect(hits).toEqual([])
  })

  test('no node: imports', () => {
    const hits = scanForImports(SRC, [/^node:/])
    expect(hits).toEqual([])
  })

  test('no direct window mutation (no "window." or "document.")', () => {
    const hits = scanForTokens(SRC, ['window.', 'document.', 'indexedDB', 'localStorage', 'sessionStorage'])
      .filter((h) => !h.text.startsWith('*') && !h.text.startsWith('//') && !h.text.startsWith('/*'))
    expect(hits).toEqual([])
  })

  test('no ipcRenderer / postMessage / fetch / showOpenFilePicker', () => {
    const hits = scanForTokens(SRC, ['ipcRenderer', 'postMessage', 'fetch(', 'showOpenFilePicker', 'showSaveFilePicker'])
      .filter((h) => !h.text.startsWith('*') && !h.text.startsWith('//') && !h.text.startsWith('/*'))
    expect(hits).toEqual([])
  })

  test('no Proxy (ADR-002 §2.2)', () => {
    const hits = scanForTokens(SRC, ['new Proxy('])
      .filter((h) => !h.text.startsWith('*') && !h.text.startsWith('//') && !h.text.startsWith('/*'))
    expect(hits).toEqual([])
  })

  test('imports from @genoffice/runtime-contracts and @genoffice/*-shared only (no direct app imports)', () => {
    // The bridge may import from runtime-contracts, platform, project-store,
    // and the @genoffice/*-shared aliases. It must NOT import from
    // @genoffice/docs, @genoffice/sheets, etc. (the app packages themselves).
    const hits = scanForImports(SRC, [
      '@genoffice/docs',
      '@genoffice/sheets',
      '@genoffice/slides',
      '@genoffice/pdf',
      '@genoffice/markdown',
      '@genoffice/shell',
    ]).filter((h) => !h.text.includes('-shared'))
    expect(hits).toEqual([])
  })
})
