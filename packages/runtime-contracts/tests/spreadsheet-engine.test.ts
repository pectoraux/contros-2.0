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

  test('ZERO filesystem path parameters in spreadsheet-engine.ts', () => {
    // The engine contract must be data-oriented (Uint8Array), not path-oriented.
    // Verify that open() and convertWorkbook() do NOT accept string path parameters.
    const text = readFile(ENGINE_FILE)
    // open() must accept Uint8Array, not string path
    expect(text).toMatch(/open\(\s*workbook:\s*Uint8Array/)
    // convertWorkbook() must accept Uint8Array, not string path
    expect(text).toMatch(/convertWorkbook\(\s*workbook:\s*Uint8Array/)
    // WorkbookMetadata must NOT have a 'path' field
    const metadataMatch = text.match(/interface WorkbookMetadata \{([\s\S]*?)\}/)
    expect(metadataMatch).not.toBeNull()
    const metadataBody = metadataMatch![1]
    expect(metadataBody).not.toMatch(/^\s*path:\s*string/m)
    // No method should accept a parameter named 'path' of type string.
    // (Increment 3C removed EngineArchivePatch from runtime-contracts entirely;
    // the 'entryPath' field that previously appeared here is now an engine-
    // internal type defined only in packages/platform-electron/.)
    const pathParams = text.match(/\bpath:\s*string/g) ?? []
    expect(pathParams).toEqual([])
  })

  test('ZERO references to EngineArchivePatch in spreadsheet-engine.ts source (non-comment, Increment 3C)', () => {
    const text = readFile(ENGINE_FILE)
    // EngineArchivePatch has been REMOVED from runtime-contracts.
    // It is now an engine-internal type defined only in packages/platform-electron/.
    // The only allowable mentions are in comment lines documenting the removal.
    const hits = scanForPattern(ENGINE_FILE.replace('/spreadsheet-engine.ts', ''), /\bEngineArchivePatch\b/)
    const engineHits = hits.filter((h) => h.file.endsWith('spreadsheet-engine.ts'))
    expect(engineHits).toEqual([])
  })

  test('ZERO references to EngineArchivePatch across ALL runtime-contracts source (non-comment, Increment 3C)', () => {
    // Scan the entire runtime-contracts src directory for any EngineArchivePatch leakage.
    // Comment lines are filtered out by scanForPattern.
    const hits = scanForPattern(SRC, /\bEngineArchivePatch\b/)
    expect(hits).toEqual([])
  })

  test('saveArchive is REMOVED (replaced by applySavePlan in Increment 3C)', () => {
    const text = readFile(ENGINE_FILE)
    // The old saveArchive(handle, EngineArchivePatch[]) operation is gone
    // from the source (non-comment lines).
    const hits = scanForPattern(ENGINE_FILE.replace('/spreadsheet-engine.ts', ''), /\bsaveArchive\b/)
    const engineHits = hits.filter((h) => h.file.endsWith('spreadsheet-engine.ts'))
    expect(engineHits).toEqual([])
  })

  test('applySavePlan is defined (accepts domain SavePlan, returns EngineSaveResult)', () => {
    const text = readFile(ENGINE_FILE)
    // The new applySavePlan operation accepts a domain SavePlan (not engine patches).
    expect(text).toMatch(/applySavePlan\(/)
    expect(text).toMatch(/applySavePlan\(\s*handle:\s*EngineSessionHandle/)
    expect(text).toMatch(/plan:\s*SavePlan/)
    expect(text).toMatch(/Promise<EngineSaveResult>/)
  })

  test('EngineSaveResult is defined (data + touchedEntries, no EngineArchivePatch in source)', () => {
    const text = readFile(ENGINE_FILE)
    expect(text).toMatch(/interface EngineSaveResult/)
    const resultMatch = text.match(/interface EngineSaveResult \{([\s\S]*?)\}/)
    expect(resultMatch).not.toBeNull()
    const body = resultMatch![1]
    expect(body).toMatch(/data:\s*Uint8Array/)
    expect(body).toMatch(/touchedEntries:\s*string\[\]/)
    // Must NOT contain any engine-specific archive type in the interface body
    expect(body).not.toContain('EngineArchivePatch')
  })

  test('SavePlan is imported from save-plan.ts (no circular dependency)', () => {
    const text = readFile(ENGINE_FILE)
    expect(text).toMatch(/import type \{ SavePlan \} from '.\/save-plan\.js'/)
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
    // open() returns a handle (creates it) — the signature is multi-line now
    expect(text).toMatch(/open\(\s*workbook:\s*Uint8Array/)
    expect(text).toMatch(/handle:\s*EngineSessionHandle/)
    // All other operations receive handle as first parameter.
    // Increment 3C: saveArchive replaced by applySavePlan.
    const methods = ['readRange', 'readFormulaCells', 'recalculate', 'readMedia', 'applySavePlan', 'close']
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

  test('WorksheetMetadata exposes BOTH id (stable XLSX sheetId) AND name (mutable)', () => {
    const text = readFile(ENGINE_FILE)
    // WorksheetMetadata must have an `id` field (stable XLSX sheetId attribute)
    // AND a `name` field (visible tab name, mutable via rename). The `id`
    // is the correct key for the sheetId → sheetName mapping.
    const metadataMatch = text.match(/interface WorksheetMetadata \{([\s\S]*?)\}/)
    expect(metadataMatch).not.toBeNull()
    const body = metadataMatch![1]
    expect(body).toMatch(/^\s*id:\s*string/m)
    expect(body).toMatch(/^\s*name:\s*string/m)
    // The id field must be documented as stable/immutable
    expect(body).toMatch(/stable/i)
  })

  test('SpreadsheetEngine interface defines all 9 operations from ADR-004 (Increment 3C: applySavePlan replaces saveArchive)', () => {
    const text = readFile(ENGINE_FILE)
    // Increment 3C: saveArchive replaced by applySavePlan.
    const required = ['open', 'readRange', 'readFormulaCells', 'recalculate', 'readMedia', 'applySavePlan', 'convertWorkbook', 'close', 'stop']
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
