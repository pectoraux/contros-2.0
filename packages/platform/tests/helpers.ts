/**
 * Architecture-boundary test helper: scans package source files for
 * forbidden import patterns and token sequences.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

export interface ScanHit {
  file: string
  line: number
  text: string
}

/**
 * Walk a directory recursively and return every `.ts`/`.tsx` file path.
 */
export function listSourceFiles(rootDir: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      const st = statSync(full)
      if (st.isDirectory()) {
        if (name === 'node_modules' || name === 'dist' || name === '.git') continue
        walk(full)
      } else if (st.isFile()) {
        const ext = extname(name)
        if (ext === '.ts' || ext === '.tsx') out.push(full)
      }
    }
  }
  walk(rootDir)
  return out
}

/**
 * Scan every source file for lines matching any of the given substrings.
 * Returns the matches; empty array means clean.
 */
export function scanForTokens(rootDir: string, forbidden: string[]): ScanHit[] {
  const hits: ScanHit[] = []
  for (const file of listSourceFiles(rootDir)) {
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      for (const token of forbidden) {
        if (line.includes(token)) {
          hits.push({ file, line: i + 1, text: line.trim() })
        }
      }
    })
  }
  return hits
}

/**
 * Scan every source file's import statements for forbidden module references.
 * Matches both `from 'x'` and `from "x"` and `require('x')`.
 */
export function scanForImports(rootDir: string, forbidden: Array<string | RegExp>): ScanHit[] {
  const hits: ScanHit[] = []
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
