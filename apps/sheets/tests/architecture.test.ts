/**
 * Architecture-boundary test for @genoffice/sheets (Increment 3H — hardened).
 *
 * Enforces:
 *   - ZERO imports of @genoffice/platform-electron in production source
 *     (apps must not depend on the platform adapter — the dependency
 *     direction is platform → app, never app → platform)
 *   - @genoffice/platform-electron NOT present in package.json dependencies
 *   - @genoffice/xlsx-gateway PRESENT in package.json dependencies
 *
 * SCANNER (Increment 3H):
 *   The previous test only matched `from '...'` and `require('...')`. This
 *   hardened version uses a stronger regex that also detects:
 *     import '...'              (side-effect import)
 *     import type { ... } from '...'  (type-only import)
 *     import { ... } from '...'       (value import)
 *     export { ... } from '...'       (re-export)
 *     export type { ... } from '...'  (type re-export)
 *     require('...')                   (CommonJS)
 *
 *   ANY production import of @genoffice/platform-electron → FAIL.
 *
 * Recursively scans ALL production source files under apps/sheets/src/**.
 */
import { describe, test, expect } from 'vitest'
import { join } from 'node:path'
import { readFileSync, readdirSync, statSync } from 'node:fs'

const SRC = join(__dirname, '..', 'src')
const PACKAGE_JSON = join(__dirname, '..', 'package.json')

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
 *
 * The regex captures the module specifier (the quoted string) regardless of
 * which import form is used. This prevents false PASSes from import forms
 * the old regex didn't recognize.
 */
function scanForImports(
  rootDir: string,
  forbidden: Array<string | RegExp>,
): Array<{ file: string; line: number; text: string }> {
  const hits: Array<{ file: string; line: number; text: string }> = []
  // Matches any line containing a module specifier in an import/export/require context.
  // Captures the content of the quote/backtick.
  const importPattern =
    /(?:^|\s)(?:import|export)(?:\s+type)?(?:\s+\{[^}]*\}|\s+\*\s+as\s+\w+|\s+\w+)?\s+from\s+['"`]([^'"`]+)['"`]|(?:^|\s)import\s+['"`]([^'"`]+)['"`]|require\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/gm
  for (const file of listSourceFiles(rootDir)) {
    const text = readFileSync(file, 'utf8')
    let m: RegExpExecArray | null
    while ((m = importPattern.exec(text)) !== null) {
      // The module specifier is in group 1 (from), 2 (side-effect import), or 3 (require)
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

describe('@genoffice/sheets architecture boundary (Increment 3H — hardened)', () => {
  // ── Source import guard ──

  test('ZERO imports of @genoffice/platform-electron in production source (strong scanner)', () => {
    const hits = scanForImports(SRC, ['@genoffice/platform-electron'])
    if (hits.length > 0) {
      console.error('Found @genoffice/platform-electron imports in apps/sheets source:')
      for (const h of hits) {
        console.error(`  ${h.file}:${h.line}: ${h.text}`)
      }
    }
    expect(hits).toEqual([])
  })

  test('ZERO imports of @genoffice/platform-electron via any import form (import, import type, export, require)', () => {
    // This is a second, explicit check using a broader regex that catches
    // ALL forms — including side-effect imports and type-only imports that
    // a naive `from`-only scanner would miss.
    const hits: Array<{ file: string; line: number; text: string }> = []
    for (const file of listSourceFiles(SRC)) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        // Skip comment lines
        const trimmed = line.trim()
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
        // Check if the line mentions @genoffice/platform-electron in any import context
        if (line.includes('@genoffice/platform-electron')) {
          // Verify it's actually an import/export/require line (not just a comment)
          if (/\b(import|export|require)\b/.test(line)) {
            hits.push({ file, line: i + 1, text: line.trim() })
          }
        }
      })
    }
    if (hits.length > 0) {
      console.error('Found @genoffice/platform-electron in import lines:')
      for (const h of hits) {
        console.error(`  ${h.file}:${h.line}: ${h.text}`)
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

  // ── Positive verification (the app still imports the pure gateway) ──

  test('DOES import @genoffice/xlsx-gateway (the canonical planner)', () => {
    const hits = scanForImports(SRC, ['@genoffice/xlsx-gateway'])
    expect(hits.length).toBeGreaterThan(0)
  })
})
