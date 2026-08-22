/**
 * Architecture-boundary test for @genoffice/platform-electron (Increment 3I — AST-based).
 *
 * Uses the TypeScript compiler API (via dep-scanner.ts) to parse source files
 * into an AST and extract actual module specifiers. This GUARANTEES:
 *   - Comments and JSDoc are NOT reported
 *   - String literals that are NOT import specifiers are NOT reported
 *   - ALL import forms ARE detected
 *
 * Enforces:
 *   - ZERO imports of apps/sheets (no upward dependency on the application)
 *   - ZERO imports of @genoffice/sheets-shared (app-layer IPC contract)
 *   - DOES import @genoffice/xlsx-gateway (the canonical gateway package)
 *   - DOES import @genoffice/runtime-contracts
 */
import { describe, test, expect } from 'vitest'
import { join } from 'node:path'
import { scanForForbiddenImports } from './dep-scanner.js'

const SRC = join(__dirname, '..', 'src')

describe('@genoffice/platform-electron architecture boundary (Increment 3I — AST-based)', () => {
  test('ZERO imports of apps/sheets (no upward dependency on the application)', () => {
    const hits = scanForForbiddenImports(SRC, [/apps\/sheets/])
    if (hits.length > 0) {
      console.error('Found apps/sheets imports in platform-electron source:')
      for (const h of hits) {
        console.error(`  ${h.file}:${h.line}: ${h.kind} '${h.specifier}'`)
      }
    }
    expect(hits).toEqual([])
  })

  test('ZERO imports of @genoffice/sheets-shared (app-layer IPC contract)', () => {
    const hits = scanForForbiddenImports(SRC, ['@genoffice/sheets-shared'])
    expect(hits).toEqual([])
  })

  test('DOES import @genoffice/xlsx-gateway (the canonical gateway package)', () => {
    const hits = scanForForbiddenImports(SRC, ['@genoffice/xlsx-gateway'])
    expect(hits.length).toBeGreaterThan(0)
  })

  test('DOES import @genoffice/runtime-contracts', () => {
    const hits = scanForForbiddenImports(SRC, ['@genoffice/runtime-contracts'])
    expect(hits.length).toBeGreaterThan(0)
  })
})
