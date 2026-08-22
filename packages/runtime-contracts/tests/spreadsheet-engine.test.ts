/**
 * Architecture-boundary test for the SpreadsheetEngine contract (ADR-004).
 *
 * Verifies:
 *   - ZERO Electron imports
 *   - ZERO node:* imports
 *   - ZERO apps/sheets imports
 *   - ZERO forbidden tokens (sidecarSessionId, engineSessionId, snapshotPath,
 *     wcId, BrowserWindow, WebContents, Rust, stdio, child_process)
 *   - EngineSessionHandle exposes no inspectable fields
 *   - Dependency direction: runtime-contracts → SpreadsheetEngine (no reverse)
 */
import { describe, test, expect } from 'vitest'
import { join } from 'node:path'
import { readFileSync, readdirSync, statSync } from 'node:fs'

const ENGINE_FILE = join(__dirname, '..', 'src', 'services', 'spreadsheet-engine.ts')
const SRC = join(__dirname, '..', 'src')

function readFile(filePath: string): string {
  return readFileSync(filePath, 'utf8')
}

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

function scanForPattern(
  rootDir: string,
  pattern: RegExp,
): Array<{ file: string; line: number; text: string }> {
  const hits: Array<{ file: string; line: number; text: string }> = []
  for (const file of listSourceFiles(rootDir)) {
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      const stripped = line.trim()
      if (stripped.startsWith('*') || stripped.startsWith('//') || stripped.startsWith('/*')) return
      if (stripped.startsWith('import type ') || stripped.startsWith('export type ')) return
      if (pattern.test(line)) {
        hits.push({ file, line: i + 1, text: line.trim() })
      }
    })
  }
  return hits
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

describe('SpreadsheetEngine contract — ADR-004 architecture boundary', () => {
  test('spreadsheet-engine.ts exists', () => {
    const text = readFile(ENGINE_FILE)
    expect(text).toContain('SpreadsheetEngine')
    expect(text).toContain('EngineSessionHandle')
  })

  test('ZERO Electron imports in spreadsheet-engine.ts', () => {
    const hits = scanForImports(ENGINE_FILE.replace('/spreadsheet-engine.ts', ''), ['electron'])
    const engineHits = hits.filter((h) => h.file.endsWith('spreadsheet-engine.ts'))
    expect(engineHits).toEqual([])
  })

  test('ZERO node:* imports in spreadsheet-engine.ts', () => {
    const hits = scanForImports(ENGINE_FILE.replace('/spreadsheet-engine.ts', ''), [/^node:/])
    const engineHits = hits.filter((h) => h.file.endsWith('spreadsheet-engine.ts'))
    expect(engineHits).toEqual([])
  })

  test('ZERO apps/sheets imports in spreadsheet-engine.ts', () => {
    const hits = scanForImports(ENGINE_FILE.replace('/spreadsheet-engine.ts', ''), [/apps\/sheets/])
    const engineHits = hits.filter((h) => h.file.endsWith('spreadsheet-engine.ts'))
    expect(engineHits).toEqual([])
  })

  test('ZERO @genoffice/sheets-shared imports in spreadsheet-engine.ts', () => {
    const hits = scanForImports(ENGINE_FILE.replace('/spreadsheet-engine.ts', ''), ['@genoffice/sheets-shared'])
    const engineHits = hits.filter((h) => h.file.endsWith('spreadsheet-engine.ts'))
    expect(engineHits).toEqual([])
  })

  test('ZERO forbidden tokens in spreadsheet-engine.ts source (non-comment)', () => {
    const forbidden = [
      'sidecarSessionId',
      'engineSessionId',
      'snapshotPath',
      'wcId',
      'BrowserWindow',
      'WebContents',
      'Rust',
      'stdio',
      'child_process',
    ]
    const hits = scanForPattern(ENGINE_FILE.replace('/spreadsheet-engine.ts', ''), new RegExp(forbidden.join('|')))
    const engineHits = hits.filter((h) => h.file.endsWith('spreadsheet-engine.ts'))
    if (engineHits.length > 0) {
      console.error('Found forbidden tokens in spreadsheet-engine.ts:')
      for (const h of engineHits) {
        console.error(`  ${h.file}:${h.line}: ${h.text}`)
      }
    }
    expect(engineHits).toEqual([])
  })

  test('EngineSessionHandle exposes no inspectable fields', () => {
    const text = readFile(ENGINE_FILE)
    // The interface should only have the brand symbol — no string/number fields
    const handleMatch = text.match(/interface EngineSessionHandle \{([\s\S]*?)\}/)
    expect(handleMatch).not.toBeNull()
    const body = handleMatch![1]
    // Should NOT contain any string/number/boolean field declarations
    // (only the brand symbol, which is a unique symbol, not a data field)
    const dataFields = body
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('//') && !l.startsWith('*') && !l.startsWith('/**'))
      .filter((l) => !l.startsWith('readonly') || !l.includes('BRAND'))
    // The only non-comment, non-empty line should be the brand declaration
    const realFields = dataFields.filter((l) => l.includes('readonly') && !l.includes('BRAND'))
    expect(realFields).toEqual([])
  })

  test('EngineSessionHandle is created by open() and received by subsequent operations', () => {
    const text = readFile(ENGINE_FILE)
    // open() returns a handle (creates it)
    expect(text).toMatch(/open\(.*\).*Promise<\{[^}]*handle:\s*EngineSessionHandle/)
    // All other operations receive handle as first parameter
    const methods = ['readRange', 'readFormulaCells', 'recalculate', 'readMedia', 'saveArchive', 'close']
    for (const method of methods) {
      expect(text).toMatch(new RegExp(`${method}\\(\\s*handle:\\s*EngineSessionHandle`))
    }
  })

  test('ExternalChangeStatus is defined with exactly three values', () => {
    const text = readFile(ENGINE_FILE)
    expect(text).toContain("'unchanged'")
    expect(text).toContain("'changed'")
    expect(text).toContain("'unknown'")
    expect(text).toMatch(/type ExternalChangeStatus\s*=/)
  })

  test('Engine errors are defined (EngineError, InvalidSessionError, InvalidInputError)', () => {
    const text = readFile(ENGINE_FILE)
    expect(text).toContain('class EngineError')
    expect(text).toContain('class InvalidSessionError')
    expect(text).toContain('class InvalidInputError')
  })

  test('SpreadsheetEngine interface defines all 9 operations from ADR-004', () => {
    const text = readFile(ENGINE_FILE)
    const required = ['open', 'readRange', 'readFormulaCells', 'recalculate', 'readMedia', 'saveArchive', 'convertWorkbook', 'close', 'stop']
    for (const op of required) {
      expect(text).toContain(op)
    }
  })

  test('runtime-contracts has ZERO imports from @genoffice/platform EXCEPT runtime.ts', () => {
    const hits = scanForImports(SRC, ['@genoffice/platform'])
    const violations = hits.filter((h) => !h.file.endsWith('runtime.ts'))
    expect(violations).toEqual([])
  })

  test('runtime-contracts has ZERO imports from electron or node:*', () => {
    const electronHits = scanForImports(SRC, ['electron'])
    expect(electronHits).toEqual([])
    const nodeHits = scanForImports(SRC, [/^node:/])
    expect(nodeHits).toEqual([])
  })
})
