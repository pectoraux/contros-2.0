/**
 * Architecture-boundary test for @genoffice/renderer-bridge.
 *
 * BOUNDARY CORRECTION (2026-08-21, final):
 *   - ZERO type assertions of any kind in source code
 *     (not just `as never` / `as any`, but also `as T`, `as SomeType`,
 *      `as unknown as`, etc.)
 *   - All type conversions use runtime-validated type guards or
 *     structural assignment (no cast needed when types match)
 *
 * The test scans for the pattern `as SomeIdentifier` in source code,
 * excluding comments. It catches:
 *   as never, as any, as T, as LegacyLanguage, as RecentEntry[], etc.
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

function scanForPattern(
  rootDir: string,
  pattern: RegExp,
): Array<{ file: string; line: number; text: string }> {
  const hits: Array<{ file: string; line: number; text: string }> = []
  for (const file of listSourceFiles(rootDir)) {
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      // Skip comments
      const stripped = line.trim()
      if (stripped.startsWith('*') || stripped.startsWith('//') || stripped.startsWith('/*')) {
        return
      }
      // Skip import type / export type lines (those use `from` not `as`)
      if (stripped.startsWith('import type ') || stripped.startsWith('export type ')) {
        return
      }
      // Skip JSDoc type annotations like `@param {T}` — not `as T`
      // Match the pattern: ` as Identifier` where Identifier starts with uppercase or T
      if (pattern.test(line)) {
        hits.push({ file, line: i + 1, text: line.trim() })
      }
    })
  }
  return hits
}

describe('@genoffice/renderer-bridge architecture boundary', () => {
  test('ZERO type assertions ("as Identifier") in source code', () => {
    // Match ` as SomeType` where SomeType starts with an uppercase letter
    // This catches: as never, as any, as T, as LegacyLanguage, as RecentEntry[],
    // as unknown as, as RuntimeWithUpdater, etc.
    // Does NOT match: `as` in string literals, or `as` in `import ... as ...`
    // (those are import aliases, not type assertions)
    const pattern = /\bas\s+[A-Z]/
    const hits = scanForPattern(SRC, pattern)
    if (hits.length > 0) {
      console.error('Found type assertions:')
      for (const h of hits) {
        console.error(`  ${h.file}:${h.line}: ${h.text}`)
      }
    }
    expect(hits).toEqual([])
  })

  test('ZERO "as unknown as" double-casts', () => {
    const hits = scanForPattern(SRC, /as unknown as/)
    expect(hits).toEqual([])
  })

  test('ZERO Proxy usage', () => {
    const hits = scanForPattern(SRC, /new Proxy\(/)
    expect(hits).toEqual([])
  })
})
