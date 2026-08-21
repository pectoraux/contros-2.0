/**
 * Dependency-direction architecture test.
 *
 * Verifies that the runtime-independent layer does NOT import from
 * the application layer. The dependency direction must be:
 *
 *   apps/docs → renderer-bridge → runtime-contracts → platform → platform-electron
 *
 * Never the inverse:
 *
 *   runtime-contracts → apps/docs  ❌
 *   services-docs → apps/docs      ❌
 *   platform → apps/shell          ❌
 *
 * Per Principal Architect directive (2026-08-21):
 *   "packages/runtime-contracts/** and packages/services-docs/** must not
 *    import: apps/apps/*lt;starapps/*gt;*, @genoffice/docs-shared"
 */
import { describe, test, expect } from 'vitest'
import { join } from 'node:path'
import { readFileSync, readdirSync, statSync } from 'node:fs'

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

describe('dependency direction: runtime layer must not import from app layer', () => {
  test('runtime-contracts has ZERO imports from @genoffice/*-shared or apps/', () => {
    const SRC = join(__dirname, '..', 'src')
    const hits = scanForImports(SRC, [
      '@genoffice/docs-shared',
      '@genoffice/sheets-shared',
      '@genoffice/slides-shared',
      '@genoffice/pdf-shared',
      '@genoffice/markdown-shared',
      '@genoffice/shell-home-shared',
      '@genoffice/shell-tabs-shared',
      '@genoffice/shell-update-shared',
    ])
    expect(hits).toEqual([])
  })

  test('services-docs has ZERO imports from @genoffice/*-shared or apps/', () => {
    const SRC = join(__dirname, '..', 'src')
    const hits = scanForImports(SRC, [
      '@genoffice/docs-shared',
      '@genoffice/sheets-shared',
      '@genoffice/slides-shared',
      '@genoffice/pdf-shared',
      '@genoffice/markdown-shared',
      '@genoffice/shell-home-shared',
      '@genoffice/shell-tabs-shared',
      '@genoffice/shell-update-shared',
    ])
    expect(hits).toEqual([])
  })

  test('services-docs has ZERO imports from @genoffice/docs (the app package itself)', () => {
    const SRC = join(__dirname, '..', 'src')
    const hits = scanForImports(SRC, [
      '@genoffice/docs',
      '@genoffice/sheets',
      '@genoffice/slides',
      '@genoffice/pdf',
      '@genoffice/markdown',
      '@genoffice/shell',
    ])
    expect(hits).toEqual([])
  })

  test('runtime-contracts has ZERO imports from @genoffice/docs (the app package itself)', () => {
    const SRC = join(__dirname, '..', 'src')
    const hits = scanForImports(SRC, [
      '@genoffice/docs',
      '@genoffice/sheets',
      '@genoffice/slides',
      '@genoffice/pdf',
      '@genoffice/markdown',
      '@genoffice/shell',
    ])
    expect(hits).toEqual([])
  })
})
