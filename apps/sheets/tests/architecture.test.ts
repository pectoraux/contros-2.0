/**
 * Architecture-boundary test for @genoffice/sheets (Increment 3I — AST-based).
 *
 * Uses the TypeScript compiler API (via dep-scanner.ts) to parse source files
 * into an AST and extract actual module specifiers. This GUARANTEES:
 *   - Comments and JSDoc are NOT reported
 *   - String literals that are NOT import specifiers are NOT reported
 *   - ALL import forms ARE detected
 *
 * Enforces:
 *   - ZERO imports of @genoffice/platform-electron in production source
 *   - @genoffice/platform-electron NOT present in package.json dependencies
 *   - @genoffice/xlsx-gateway PRESENT in package.json dependencies
 *   - DOES import @genoffice/xlsx-gateway (positive check)
 */
import { describe, test, expect } from 'vitest'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { scanForForbiddenImports } from './dep-scanner.js'

const SRC = join(__dirname, '..', 'src')
const PACKAGE_JSON = join(__dirname, '..', 'package.json')

describe('@genoffice/sheets architecture boundary (Increment 3I — AST-based)', () => {
  // ── Source import guard ──

  test('ZERO imports of @genoffice/platform-electron in production source', () => {
    const hits = scanForForbiddenImports(SRC, ['@genoffice/platform-electron'])
    if (hits.length > 0) {
      console.error('Found @genoffice/platform-electron imports in apps/sheets source:')
      for (const h of hits) {
        console.error(`  ${h.file}:${h.line}: ${h.kind} '${h.specifier}'`)
      }
    }
    expect(hits).toEqual([])
  })

  // ── Manifest dependency guard ──

  test('package.json does NOT declare @genoffice/platform-electron as a dependency', () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'))
    const deps = pkg.dependencies ?? {}
    const devDeps = pkg.devDependencies ?? {}
    expect(deps).not.toHaveProperty('@genoffice/platform-electron')
    expect(devDeps).not.toHaveProperty('@genoffice/platform-electron')
  })

  test('package.json DOES declare @genoffice/xlsx-gateway as a dependency (canonical planner)', () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'))
    const deps = pkg.dependencies ?? {}
    expect(deps).toHaveProperty('@genoffice/xlsx-gateway')
  })

  // ── Positive verification ──

  test('DOES import @genoffice/xlsx-gateway (the canonical planner)', () => {
    const hits = scanForForbiddenImports(SRC, ['@genoffice/xlsx-gateway'])
    expect(hits.length).toBeGreaterThan(0)
  })
})
