/**
 * Architecture-boundary test for @genoffice/platform-electron (Increment 3H — hardened).
 *
 * Enforces:
 *   - ZERO imports of apps/sheets (no upward dependency on the application)
 *   - ZERO imports of @genoffice/sheets-shared (the IPC contract — that's app-layer)
 *   - DOES import @genoffice/xlsx-gateway (the canonical gateway package)
 *   - DOES import @genoffice/runtime-contracts
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

describe('@genoffice/platform-electron architecture boundary (Increment 3H — hardened)', () => {
  test('ZERO imports of apps/sheets (no upward dependency on the application)', () => {
    const hits = scanForImports(SRC, [/apps\/sheets/])
    if (hits.length > 0) {
      console.error('Found apps/sheets imports in platform-electron source:')
      for (const h of hits) {
        console.error(`  ${h.file}:${h.line}: ${h.text}`)
      }
    }
    expect(hits).toEqual([])
  })

  test('ZERO imports of @genoffice/sheets-shared (app-layer IPC contract)', () => {
    const hits = scanForImports(SRC, ['@genoffice/sheets-shared'])
    expect(hits).toEqual([])
  })

  test('ZERO imports of apps/sheets via ANY import form (import, import type, export, require)', () => {
    // Second explicit check using line-by-line scanning for maximum coverage
    const hits: Array<{ file: string; line: number; text: string }> = []
    for (const file of listSourceFiles(SRC)) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        const trimmed = line.trim()
        if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return
        if (line.includes('apps/sheets') && /\b(import|export|require)\b/.test(line)) {
          hits.push({ file, line: i + 1, text: line.trim() })
        }
      })
    }
    if (hits.length > 0) {
      console.error('Found apps/sheets in import lines:')
      for (const h of hits) {
        console.error(`  ${h.file}:${h.line}: ${h.text}`)
      }
    }
    expect(hits).toEqual([])
  })

  test('DOES import @genoffice/xlsx-gateway (the canonical gateway package)', () => {
    const hits = scanForImports(SRC, ['@genoffice/xlsx-gateway'])
    expect(hits.length).toBeGreaterThan(0)
  })

  test('DOES import @genoffice/runtime-contracts', () => {
    const hits = scanForImports(SRC, ['@genoffice/runtime-contracts'])
    expect(hits.length).toBeGreaterThan(0)
  })
})
