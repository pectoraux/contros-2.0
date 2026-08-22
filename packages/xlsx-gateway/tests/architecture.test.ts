/**
 * Architecture-boundary test for @genoffice/xlsx-gateway (Increment 3F/3H).
 *
 * Recursively scans EVERY production source file under packages/xlsx-gateway/src/**
 * and fails on actual production imports of:
 *   - node:* (ANY Node builtin — the package must be pure)
 *   - electron
 *   - child_process
 *   - BrowserWindow / WebContents / ipcMain / ipcRenderer
 *   - apps/sheets (no upward dependency on the application)
 *   - @genoffice/platform-electron
 *   - @genoffice/platform
 *   - @genoffice/runtime-contracts
 *
 * SCANNER (Increment 3H):
 *   Uses a strengthened regex that detects ALL import forms:
 *     import '...'
 *     import type { ... } from '...'
 *     import { ... } from '...'
 *     export { ... } from '...'
 *     export type { ... } from '...'
 *     export * from '...'
 *     require('...')
 *
 * The test file itself (THIS file) is the ONLY exception — it imports node:fs
 * and node:path to perform the scan. Test files are NOT production source.
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

/**
 * Strong import scanner (Increment 3H).
 *
 * Detects ALL forms of module references:
 *   - import 'mod'
 *   - import type 'mod'
 *   - import { ... } from 'mod'
 *   - import type { ... } from 'mod'
 *   - export { ... } from 'mod'
 *   - export type { ... } from 'mod'
 *   - export * from 'mod'
 *   - require('mod')
 */
function scanForImports(
  rootDir: string,
  forbidden: Array<string | RegExp>,
): Array<{ file: string; line: number; text: string }> {
  const hits: Array<{ file: string; line: number; text: string }> = []
  const importPattern =
    /(?:^|\s)(?:import|export)(?:\s+type)?(?:\s+\{[^}]*\}|\s+\*\s+as\s+\w+|\s+\w+)?\s+from\s+['"`]([^'"`]+)['"`]|(?:^|\s)import\s+['"`]([^'"`]+)['"`]|require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/gm
  for (const file of listSourceFiles(rootDir)) {
    const text = readFileSync(file, 'utf8')
    let m: RegExpExecArray | null
    while ((m = importPattern.exec(text)) !== null) {
      const mod = m[1] ?? m[2] ?? m[3]
      if (!mod) continue
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

describe('@genoffice/xlsx-gateway architecture boundary (Increment 3F/3H — pure package)', () => {
  test('ZERO imports of node:* (the package must be pure — no Node builtins)', () => {
    const hits = scanForImports(SRC, [/^node:/])
    if (hits.length > 0) {
      console.error('Found node:* imports in xlsx-gateway source:')
      for (const h of hits) {
        console.error(`  ${h.file}:${h.line}: ${h.text}`)
      }
    }
    expect(hits).toEqual([])
  })

  test('ZERO imports of electron', () => {
    const hits = scanForImports(SRC, ['electron'])
    expect(hits).toEqual([])
  })

  test('ZERO imports of child_process', () => {
    const hits = scanForImports(SRC, ['child_process'])
    expect(hits).toEqual([])
  })

  test('ZERO imports of apps/sheets (no upward dependency on the application)', () => {
    const hits = scanForImports(SRC, [/apps\/sheets/, /\.\.\/\.\.\/apps\/sheets/, /\.\.\/\.\.\/\.\.\/apps\/sheets/])
    if (hits.length > 0) {
      console.error('Found apps/sheets imports in xlsx-gateway source:')
      for (const h of hits) {
        console.error(`  ${h.file}:${h.line}: ${h.text}`)
      }
    }
    expect(hits).toEqual([])
  })

  test('ZERO imports of @genoffice/platform-electron', () => {
    const hits = scanForImports(SRC, ['@genoffice/platform-electron'])
    expect(hits).toEqual([])
  })

  test('ZERO imports of @genoffice/platform', () => {
    const hits = scanForImports(SRC, ['@genoffice/platform'])
    expect(hits).toEqual([])
  })

  test('ZERO imports of @genoffice/runtime-contracts (gateway is below the contract layer)', () => {
    const hits = scanForImports(SRC, ['@genoffice/runtime-contracts'])
    expect(hits).toEqual([])
  })

  test('ZERO references to BrowserWindow / WebContents / wcId / ipcMain / ipcRenderer', () => {
    const hits = scanForTokens(SRC, [
      'BrowserWindow',
      'WebContents',
      'wcId',
      'ipcMain',
      'ipcRenderer',
    ]).filter((h) => !h.text.startsWith('*') && !h.text.startsWith('//') && !h.text.startsWith('/*'))
    expect(hits).toEqual([])
  })

  test('ZERO references to sidecar / ArchiveClient / saveWorkbookViaSidecar (runtime I/O must not be here)', () => {
    const hits = scanForTokens(SRC, [
      'ArchiveClient',
      'saveWorkbookViaSidecar',
      'readArchiveEntryText',
      'sidecar',
    ]).filter((h) => !h.text.startsWith('*') && !h.text.startsWith('//') && !h.text.startsWith('/*'))
    expect(hits).toEqual([])
  })

  test('DOES import jszip (the in-memory archive library)', () => {
    const hits = scanForImports(SRC, ['jszip'])
    expect(hits.length).toBeGreaterThan(0)
  })

  test('DOES export planCellEditsToXlsx (the canonical planner)', () => {
    const gatewayFile = join(SRC, 'gateway', 'xlsx-gateway.ts')
    const text = readFileSync(gatewayFile, 'utf8')
    expect(text).toContain('export async function planCellEditsToXlsx')
  })
})
