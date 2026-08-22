/**
 * Architecture-boundary test for @genoffice/platform-electron.
 *
 * Enforces:
 *   - ZERO imports of apps/sheets (no upward dependency on the application)
 *   - ZERO imports of @genoffice/sheets-shared (the IPC contract — that's app-layer)
 *   - DOES import @genoffice/xlsx-gateway (the canonical gateway package)
 *   - DOES import @genoffice/runtime-contracts
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

describe('@genoffice/platform-electron architecture boundary (Increment 3E)', () => {
  test('ZERO imports of apps/sheets (no upward dependency on the application)', () => {
    const hits = scanForImports(SRC, [/apps\/sheets/])
    expect(hits).toEqual([])
  })

  test('ZERO imports of @genoffice/sheets-shared (app-layer IPC contract)', () => {
    const hits = scanForImports(SRC, ['@genoffice/sheets-shared'])
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
