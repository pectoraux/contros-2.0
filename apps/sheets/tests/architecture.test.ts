/**
 * Architecture-boundary test for @genoffice/sheets (Increment 3I/5 — AST-based).
 *
 * Uses the TypeScript compiler API (via dep-scanner.ts) to parse source files
 * into an AST and extract actual module specifiers. This GUARANTEES:
 *   - Comments and JSDoc are NOT reported
 *   - String literals that are NOT import specifiers are NOT reported
 *   - ALL import forms ARE detected
 *
 * Enforces:
 *   - ZERO imports of @genoffice/platform-electron EXCEPT in:
 *     sheets-runtime.ts (constructs ElectronXlsxSidecarEngine)
 *     sheets-migrated-handlers.ts (thin IPC adapter, no domain logic)
 *   - package.json declares @genoffice/platform-electron (runtime construction)
 *   - package.json declares @genoffice/xlsx-gateway (canonical planner)
 *   - DOES import @genoffice/xlsx-gateway
 */
import { describe, test, expect } from 'vitest'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { extractImports, listSourceFiles } from './dep-scanner.js'

const SRC = join(__dirname, '..', 'src')
const PACKAGE_JSON = join(__dirname, '..', 'package.json')

function scanForImports(rootDir: string, forbidden: string[]): Array<{ file: string; line: number; specifier: string; kind: string }> {
  const hits: Array<{ file: string; line: number; specifier: string; kind: string }> = []
  for (const file of listSourceFiles(rootDir)) {
    const imports = extractImports(file)
    for (const imp of imports) {
      for (const f of forbidden) {
        if (imp.specifier === f || imp.specifier.startsWith(f + '/')) {
          hits.push({ file, line: imp.line, specifier: imp.specifier, kind: imp.kind })
        }
      }
    }
  }
  return hits
}

describe('@genoffice/sheets architecture boundary (Increment 3I/5 — AST-based)', () => {
  test('ZERO imports of @genoffice/platform-electron in production source (except runtime/handlers)', () => {
    // Exception: sheets-runtime.ts and sheets-migrated-handlers.ts are
    // the runtime construction + thin IPC adapter — they are the ONLY
    // modules permitted to import from platform-electron, because they
    // construct the ElectronXlsxSidecarEngine. All other source files
    // must NOT import platform-electron.
    const hits = scanForImports(SRC, ['@genoffice/platform-electron'])
    const violations = hits.filter((h) =>
      !h.file.endsWith('sheets-runtime.ts') &&
      !h.file.endsWith('sheets-migrated-handlers.ts'),
    )
    if (violations.length > 0) {
      console.error('Found @genoffice/platform-electron imports in apps/sheets source:')
      for (const h of violations) {
        console.error(`  ${h.file}:${h.line}: ${h.kind} '${h.specifier}'`)
      }
    }
    expect(violations).toEqual([])
  })

  test('package.json declares @genoffice/platform-electron as dependency (runtime construction)', () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'))
    const deps = pkg.dependencies ?? {}
    expect(deps).toHaveProperty('@genoffice/platform-electron')
  })

  test('package.json DOES declare @genoffice/xlsx-gateway as a dependency (canonical planner)', () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'))
    const deps = pkg.dependencies ?? {}
    expect(deps).toHaveProperty('@genoffice/xlsx-gateway')
  })

  test('DOES import @genoffice/xlsx-gateway (the canonical planner)', () => {
    const hits = scanForImports(SRC, ['@genoffice/xlsx-gateway'])
    expect(hits.length).toBeGreaterThan(0)
  })
})
