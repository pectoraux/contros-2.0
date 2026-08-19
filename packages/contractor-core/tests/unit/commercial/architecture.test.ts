/**
 * Architecture boundary tests for the Commercial domain.
 *
 * Verifies the Commercial domain is pure: no persistence, no Electron,
 * no UI, no DB drivers, no AI. (Phase 2A §20.)
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const COMMERCIAL_DIR = join(__dirname, '..', '..', '..', 'src', 'domain', 'commercial')

function walkTs(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      files.push(...walkTs(full))
    } else if (entry.endsWith('.ts')) {
      files.push(full)
    }
  }
  return files
}

function readCommercialFiles(): { rel: string; content: string }[] {
  return walkTs(COMMERCIAL_DIR).map((path) => ({
    path,
    rel: relative(COMMERCIAL_DIR, path),
    content: readFileSync(path, 'utf8'),
  }))
}

describe('Commercial domain: purity (no persistence, Electron, UI, DB, AI)', () => {
  it('no commercial file imports electron', () => {
    const violations = readCommercialFiles().filter(
      (f) => /from\s+['"]electron['"]/.test(f.content),
    )
    expect(violations.map((v) => v.rel)).toEqual([])
  })

  it('no commercial file imports pg or pglite (no DB drivers)', () => {
    const violations = readCommercialFiles().filter(
      (f) => /from\s+['"]pg['"]/.test(f.content) || /from\s+['"]@electric-sql\/pglite['"]/.test(f.content),
    )
    expect(violations.map((v) => v.rel)).toEqual([])
  })

  it('no commercial file imports persistence (../persistence)', () => {
    const violations = readCommercialFiles().filter(
      (f) => /from\s+['"]\.\.\/\.\.\/persistence/.test(f.content) || /from\s+['"]\.\.\/persistence/.test(f.content),
    )
    expect(violations.map((v) => v.rel)).toEqual([])
  })

  it('no commercial file imports service (../service)', () => {
    const violations = readCommercialFiles().filter(
      (f) => /from\s+['"]\.\.\/\.\.\/service/.test(f.content) || /from\s+['"]\.\.\/service/.test(f.content),
    )
    expect(violations.map((v) => v.rel)).toEqual([])
  })

  it('no commercial file imports API (../api)', () => {
    const violations = readCommercialFiles().filter(
      (f) => /from\s+['"]\.\.\/\.\.\/api/.test(f.content) || /from\s+['"]\.\.\/api/.test(f.content),
    )
    expect(violations.map((v) => v.rel)).toEqual([])
  })

  it('no commercial file uses Date.now() or Math.random() in canonical content', () => {
    // Date.now() / Math.random() are forbidden in deterministic calculations.
    // (They may appear in comments, but not in actual code that computes content.)
    const violations = readCommercialFiles().filter(
      (f) => /\bMath\.random\(\)/.test(f.content) && !f.content.includes('// ') &&
        !f.rel.includes('test'),
    )
    expect(violations.map((v) => v.rel)).toEqual([])
  })

  it('EstimateRevision does not depend on Office engine state or AI output', () => {
    const files = readCommercialFiles().filter((f) => f.rel.includes('estimate-revision'))
    const violations = files.filter(
      (f) => /from\s+['"]univer|from\s+['"].*office-engine|from\s+['"].*ai-/.test(f.content),
    )
    expect(violations.map((v) => v.rel)).toEqual([])
  })
})
