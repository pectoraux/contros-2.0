/**
 * Architecture tests — enforce boundary rules from the constitution.
 * (Phase 1 section 23.)
 *
 * These tests verify the structural invariants that make it difficult for
 * future code to violate the architecture:
 *  - Contractor Core has NO Electron dependency
 *  - The domain layer imports NO external packages (only node:crypto)
 *  - The service layer does NOT import pg/pglite directly (must go through DbClient)
 *  - The API layer does NOT import pg/pglite
 *  - No file imports 'electron'
 *  - The AuditRepository exposes no update/delete methods
 *  - The RevisionRepository exposes no delete method
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC_DIR = resolve(__dirname, '../../src')

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

function readSrcFiles(): { path: string; rel: string; content: string }[] {
  return walkTs(SRC_DIR).map((path) => ({
    path,
    rel: relative(SRC_DIR, path),
    content: readFileSync(path, 'utf8'),
  }))
}

describe('architecture: no Electron dependency in Contractor Core', () => {
  it('no src/ file imports "electron"', () => {
    const violations = readSrcFiles().filter(
      (f) => /from\s+['"]electron['"]/.test(f.content) || /require\(['"]electron['"]\)/.test(f.content),
    )
    expect(violations.map((v) => v.rel)).toEqual([])
  })
})

describe('architecture: domain layer is pure (zero external deps)', () => {
  it('src/domain/ imports only node: builtins and local modules', () => {
    const domainFiles = readSrcFiles().filter((f) => f.rel.startsWith('domain/'))
    const forbidden = domainFiles.filter((f) => {
      // Allow imports from 'node:' and relative './...' and '../'
      const importLines = f.content.matchAll(/from\s+['"]([^'"]+)['"]/g)
      for (const m of importLines) {
        const dep = m[1]!
        if (dep.startsWith('node:')) continue
        if (dep.startsWith('.') || dep.startsWith('/')) continue
        return true // found an external import
      }
      return false
    })
    expect(forbidden.map((f) => f.rel)).toEqual([])
  })
})

describe('architecture: service layer does not import database drivers', () => {
  it('src/service/ does NOT import pg or @electric-sql/pglite', () => {
    const serviceFiles = readSrcFiles().filter((f) => f.rel.startsWith('service/'))
    const violations = serviceFiles.filter(
      (f) => /from\s+['"]pg['"]/.test(f.content) || /from\s+['"]@electric-sql\/pglite['"]/.test(f.content),
    )
    expect(violations.map((v) => v.rel)).toEqual([])
  })
})

describe('architecture: API layer does not import database drivers', () => {
  it('src/api/ does NOT import pg or @electric-sql/pglite', () => {
    const apiFiles = readSrcFiles().filter((f) => f.rel.startsWith('api/'))
    const violations = apiFiles.filter(
      (f) => /from\s+['"]pg['"]/.test(f.content) || /from\s+['"]@electric-sql\/pglite['"]/.test(f.content),
    )
    expect(violations.map((v) => v.rel)).toEqual([])
  })
})

describe('architecture: repository immutability contracts', () => {
  it('AuditRepository exposes no update() or delete() methods', async () => {
    const { AuditRepository } = await import('../../src/persistence/repositories/audit.repository.js')
    const repo = new AuditRepository({} as never) // don't need a real client for this check
    expect((repo as unknown as { update?: unknown }).update).toBeUndefined()
    expect((repo as unknown as { delete?: unknown }).delete).toBeUndefined()
    expect((repo as unknown as { remove?: unknown }).remove).toBeUndefined()
  })

  it('RevisionRepository exposes no delete() method', async () => {
    const { RevisionRepository } = await import('../../src/persistence/repositories/revision.repository.js')
    const repo = new RevisionRepository({} as never)
    expect((repo as unknown as { delete?: unknown }).delete).toBeUndefined()
    expect((repo as unknown as { remove?: unknown }).remove).toBeUndefined()
  })
})

describe('architecture: domain does not import persistence', () => {
  it('src/domain/ does NOT import from src/persistence/', () => {
    const domainFiles = readSrcFiles().filter((f) => f.rel.startsWith('domain/'))
    const violations = domainFiles.filter((f) => /from\s+['"]\.\.\/persistence/.test(f.content))
    expect(violations.map((v) => v.rel)).toEqual([])
  })
})
