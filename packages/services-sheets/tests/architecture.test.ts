/**
 * Architecture-boundary test for @genoffice/services-sheets.
 *
 * Enforces:
 *   - ZERO imports of electron
 *   - ZERO imports of node:* (no node:fs, node:crypto, node:path, node:buffer)
 *   - ZERO references to BrowserWindow / webContents / wcId
 *   - ZERO references to child_process / Rust / stdio
 *   - ZERO references to snapshotPath / sidecarSessionId / engineSessionId
 *   - Does NOT import platform-electron
 *   - DOES import runtime-contracts (dependency direction)
 *
 * DOMAIN-EVENT PURITY (Increment 3A correction):
 *   - ZERO references to SheetsEventBus
 *   - ZERO references to onOpened / onRenamed / onTeardown
 *   - ZERO references to oldPath / newPath
 *   The shell coordinator owns renderer/event routing — the domain service
 *   must NOT.
 */
import { describe, test, expect } from 'vitest'
import { join } from 'node:path'
import { readFileSync, readdirSync, statSync } from 'node:fs'

const SRC = join(__dirname, '..', 'src')

function listSourceFiles(rootDir: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      const st = statSync(full)
      if (st.isDirectory()) {
        if (name === 'node_modules' || name === 'dist' || name === '.git') continue
        walk(full)
      } else if (st.isFile() && (full.endsWith('.ts') || full.endsWith('.tsx'))) {
        out.push(full)
      }
    }
  }
  walk(rootDir)
  return out
}

function scanForImports(
  rootDir: string,
  forbidden: Array<string | RegExp>,
): Array<{ file: string; line: number; text: string }> {
  const hits: Array<{ file: string; line: number; text: string }> = []
  const importPattern = /(?:from\s+|require\s*\(\s*)['"]([^'"]+)['"]/g
  for (const file of listSourceFiles(rootDir)) {
    const text = readFileSync(file, 'utf8')
    let m: RegExpExecArray | null
    while ((m = importPattern.exec(text)) !== null) {
      const mod = m[1]
      const lineNum = text.slice(0, m.index).split('\n').length
      for (const f of forbidden) {
        const isHit = typeof f === 'string' ? mod === f || mod.startsWith(f + '/') : f.test(mod)
        if (isHit) {
          hits.push({ file, line: lineNum, text: `import ... from '${mod}'` })
        }
      }
    }
  }
  return hits
}

function scanForTokens(rootDir: string, forbidden: string[]): Array<{ file: string; line: number; text: string }> {
  const hits: Array<{ file: string; line: number; text: string }> = []
  for (const file of listSourceFiles(rootDir)) {
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      for (const token of forbidden) {
        if (line.includes(token)) {
          hits.push({ file, line: i + 1, text: line.trim() })
        }
      }
    })
  }
  return hits
}

describe('@genoffice/services-sheets architecture boundary', () => {
  test('ZERO imports of electron', () => {
    const hits = scanForImports(SRC, ['electron'])
    expect(hits).toEqual([])
  })

  test('ZERO imports of node:*', () => {
    const hits = scanForImports(SRC, [/^node:/])
    expect(hits).toEqual([])
  })

  test('ZERO references to BrowserWindow / webContents / wcId', () => {
    const hits = scanForTokens(SRC, [
      'BrowserWindow',
      'webContents',
      'wcId',
      'WebContentsView',
    ]).filter((h) => !h.text.startsWith('*') && !h.text.startsWith('//') && !h.text.startsWith('/*'))
    expect(hits).toEqual([])
  })

  test('ZERO references to child_process / Rust / stdio', () => {
    const hits = scanForTokens(SRC, [
      'child_process',
      'Rust',
      'stdio',
    ]).filter((h) => !h.text.startsWith('*') && !h.text.startsWith('//') && !h.text.startsWith('/*'))
    expect(hits).toEqual([])
  })

  test('ZERO references to snapshotPath / sidecarSessionId / engineSessionId', () => {
    const hits = scanForTokens(SRC, [
      'snapshotPath',
      'sidecarSessionId',
      'engineSessionId',
    ]).filter((h) => !h.text.startsWith('*') && !h.text.startsWith('//') && !h.text.startsWith('/*'))
    expect(hits).toEqual([])
  })

  test('does NOT import platform-electron', () => {
    const hits = scanForImports(SRC, ['@genoffice/platform-electron'])
    expect(hits).toEqual([])
  })

  test('does NOT import from apps/sheets', () => {
    const hits = scanForImports(SRC, [/apps\/sheets/])
    expect(hits).toEqual([])
  })

  test('does NOT import XlsxSidecarClient', () => {
    const hits = scanForTokens(SRC, ['XlsxSidecarClient'])
    expect(hits).toEqual([])
  })

  test('imports runtime-contracts (dependency direction)', () => {
    const hits = scanForImports(SRC, ['@genoffice/runtime-contracts'])
    expect(hits.length).toBeGreaterThan(0)
  })

  // ── DOMAIN-EVENT PURITY (Increment 3A correction) ──────────────────
  //
  // The domain service must NOT own renderer/event routing. The shell
  // coordinator owns `docs/workbook opened`, `renamed`, `teardown` and
  // dispatches renderer notifications. The runtime-independent service
  // contract must remain domain-only.

  test('ZERO references to SheetsEventBus (shell owns event routing)', () => {
    const hits = scanForTokens(SRC, ['SheetsEventBus'])
      .filter((h) => !h.text.startsWith('*') && !h.text.startsWith('//') && !h.text.startsWith('/*'))
    expect(hits).toEqual([])
  })

  test('ZERO references to onOpened / onRenamed / onTeardown', () => {
    const hits = scanForTokens(SRC, ['onOpened', 'onRenamed', 'onTeardown'])
      .filter((h) => !h.text.startsWith('*') && !h.text.startsWith('//') && !h.text.startsWith('/*'))
    expect(hits).toEqual([])
  })

  test('ZERO references to oldPath / newPath (no filesystem-specific event payloads)', () => {
    const hits = scanForTokens(SRC, ['oldPath', 'newPath'])
      .filter((h) => !h.text.startsWith('*') && !h.text.startsWith('//') && !h.text.startsWith('/*'))
    expect(hits).toEqual([])
  })

  test('ZERO references to WebContents / BrowserWindow / wcId (shell-layer concerns)', () => {
    const hits = scanForTokens(SRC, ['WebContents', 'BrowserWindow', 'wcId'])
      .filter((h) => !h.text.startsWith('*') && !h.text.startsWith('//') && !h.text.startsWith('/*'))
    expect(hits).toEqual([])
  })

  test('ZERO references to workbookPath (renamed to workbookName in 3A)', () => {
    const hits = scanForTokens(SRC, ['workbookPath'])
      .filter((h) => !h.text.startsWith('*') && !h.text.startsWith('//') && !h.text.startsWith('/*'))
    expect(hits).toEqual([])
  })

  // ── SAVE DOMAIN MODEL (Increment 3B correction) ───────────────────
  //
  // The service must NOT leak EngineArchivePatch[] into its public API.
  // The service accepts a domain SavePlan (preserving all mutation families)
  // and translates to EngineArchivePatch[] at the final engine boundary
  // via the injected SavePlanTranslator. The service IMPLEMENTATION may
  // reference EngineArchivePatch only inside the translator delegation
  // (it receives a SavePlanTranslation with patches: EngineArchivePatch[]).
  // The service CONTRACT must NOT expose EngineArchivePatch directly.

  test('ZERO references to EngineArchivePatch in the service implementation source (translator boundary)', () => {
    // The service implementation may reference EngineArchivePatch only via
    // the SavePlanTranslation type (which is a runtime-contracts type).
    // The service must NOT construct EngineArchivePatch[] directly.
    const hits = scanForTokens(SRC, ['EngineArchivePatch'])
      .filter((h) => !h.text.startsWith('*') && !h.text.startsWith('//') && !h.text.startsWith('/*'))
    expect(hits).toEqual([])
  })

  test('ZERO references to xlsx-gateway / xlsx-package-io (engine boundary translation is injected)', () => {
    const hits = scanForImports(SRC, [/xlsx-gateway/, /xlsx-package-io/])
    expect(hits).toEqual([])
  })

  test('ZERO references to XlsxSidecarClient / sidecar (no direct sidecar coupling)', () => {
    const hits = scanForTokens(SRC, ['XlsxSidecarClient', 'sidecar'])
      .filter((h) => !h.text.startsWith('*') && !h.text.startsWith('//') && !h.text.startsWith('/*'))
    expect(hits).toEqual([])
  })

  test('SpreadsheetServiceDeps is referenced (includes SavePlanTranslator dependency)', () => {
    // The service implementation uses SpreadsheetServiceDeps which contains
    // the savePlanTranslator dependency. The translator is an injected
    // dependency — the service does NOT reference the translator type by name
    // directly, only via the deps interface.
    const hits = scanForTokens(SRC, ['SpreadsheetServiceDeps'])
      .filter((h) => !h.text.startsWith('*') && !h.text.startsWith('//') && !h.text.startsWith('/*'))
    expect(hits.length).toBeGreaterThan(0)
  })
})
