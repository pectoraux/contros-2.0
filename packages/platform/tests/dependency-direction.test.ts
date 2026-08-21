/**
 * Dependency-direction architecture test for @genoffice/platform.
 *
 * Verifies that platform does NOT import from any @genoffice/*-shared
 * alias (which points to apps/apps/apps/*lt;starapps/*gt;/src/shared/lt;starapps/apps/*lt;starapps/*gt;/src/shared/gt;/src/shared/) or any app package.
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

describe('dependency direction: platform must not import from app layer', () => {
  test('platform has ZERO imports from @genoffice/*-shared', () => {
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

  test('platform has ZERO imports from app packages (@genoffice/docs, etc.)', () => {
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
