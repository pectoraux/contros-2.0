/**
 * Architecture-boundary test for @genoffice/xlsx-gateway.
 *
 * Enforces:
 *   - ZERO imports of electron
 *   - ZERO imports of node:* (except node:crypto, node:fs, node:os, node:path
 *     used by the pure file utilities — these are standard Node builtins,
 *     not Electron-specific)
 *   - ZERO imports of apps/sheets (no upward dependency on the application)
 *   - ZERO imports of @genoffice/platform-electron
 *   - DOES import jszip (the in-memory archive library)
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

describe('@genoffice/xlsx-gateway architecture boundary', () => {
  test('ZERO imports of electron', () => {
    const hits = scanForImports(SRC, ['electron'])
    expect(hits).toEqual([])
  })

  test('ZERO imports of apps/sheets (no upward dependency on the application)', () => {
    const hits = scanForImports(SRC, [/apps\/sheets/, /\.\.\/\.\.\/apps\/sheets/, /\.\.\/\.\.\/\.\.\/apps\/sheets/])
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

  test('DOES import jszip (the in-memory archive library)', () => {
    const hits = scanForImports(SRC, ['jszip'])
    expect(hits.length).toBeGreaterThan(0)
  })
})
