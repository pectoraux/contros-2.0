/**
 * Architecture tests for the browser layer (apps/web) + web-host.
 * (Phase 2C.1 §18, §19)
 *
 * Enforces:
 *  - apps/web cannot import electron / electron-utils / shell / persistence / pg / pglite
 *  - apps/web cannot contain SQL / pricing formulas / audit mutation / tenant-authority construction
 *  - web-host contains no raw SQL (all persistence SQL in repositories)
 *  - web-host contains no pricing formulas (derived values from domain/service)
 *  - web-host contains no direct audit mutation (audit inside service transactions)
 *  - web-host is the composition root — repository imports ARE allowed (it wires repos into services/CoreApi)
 *
 * Reads actual source files. Skips comment lines to avoid false positives.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..', '..', '..')

function exists(p: string): boolean {
  try { statSync(p); return true } catch { return false }
}
function walkTs(dir: string): string[] {
  const files: string[] = []
  if (!exists(dir)) return files
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      files.push(...walkTs(full))
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      files.push(full)
    }
  }
  return files
}
function readFiles(dir: string): { rel: string; content: string }[] {
  return walkTs(dir).map((p) => ({ rel: relative(REPO_ROOT, p), content: readFileSync(p, 'utf8') }))
}
function nonCommentLines(content: string): string[] {
  return content.split('\n').filter((line) => {
    const t = line.trim()
    return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
  })
}

// ── apps/web boundary ──────────────────────────────────────────────────────

describe('architecture: apps/web cannot import Electron / persistence / DB drivers', () => {
  it('apps/web does NOT import electron, @genoffice/electron-utils, apps/shell, pg, @electric-sql/pglite, @contractor/core/persistence, @contractor/core/service, @contractor/core/storage', () => {
    const webDir = join(REPO_ROOT, 'apps', 'web')
    const webFiles = readFiles(webDir)
    const forbidden = [
      /from\s+['"]electron['"]/, /from\s+['"]@genoffice\/electron-utils['"]/,
      /from\s+['"]@genoffice\/project-store['"]/, /from\s+['"]apps\/shell/,
      /from\s+['"]pg['"]/, /from\s+['"]@electric-sql\/pglite['"]/,
      /from\s+['"]@contractor\/core\/persistence['"]/, /from\s+['"]@contractor\/core\/service['"]/,
      /from\s+['"]@contractor\/core\/storage['"]/,
    ]
    const violations = webFiles.filter((f) => forbidden.some((re) => re.test(f.content)))
    expect(violations.map((v) => v.rel)).toEqual([])
  })
})

describe('architecture: apps/web contains no SQL / pricing / audit / tenant authority', () => {
  it('apps/web does NOT contain INSERT/UPDATE/DELETE/SELECT SQL, pricing formulas, audit mutation, or tenantId-as-authority', () => {
    const webDir = join(REPO_ROOT, 'apps', 'web')
    const webFiles = readFiles(webDir)
    const sqlRe = /['"`]\s*(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|SELECT\s+[\s\S]*?\s+FROM)/i
    const pricingRe = /\b(totalCost|sellPrice|grossProfit|grossMargin|overhead|contingency)\s*=\s*[^=]/
    const auditRe = /AuditRepository|\.append\s*\(\s*\)|audit\.record\s*\(/
    const tenantAuthorityRe = /\btenantId\s*=\s*[^=]/
    const violations = webFiles.filter((f) => {
      const lines = nonCommentLines(f.content)
      return lines.some((line) =>
        sqlRe.test(line) || pricingRe.test(line) || auditRe.test(line) || tenantAuthorityRe.test(line),
      )
    })
    expect(violations.map((v) => v.rel)).toEqual([])
  })
})

// ── web-host boundary ──────────────────────────────────────────────────────
//
// The web-host is the composition root + HTTP transport adapter. It wires
// repositories into application services and CoreApi, then delegates HTTP
// requests to CoreApi.handle(). Repository imports are ALLOWED in web-host
// because it is the composition root (same as test setup). What is FORBIDDEN:
//  - raw SQL (all persistence SQL must be in repository methods)
//  - pricing formulas (derived values come from the domain/service layer)
//  - direct audit mutation from HTTP handlers (audit is emitted inside service transactions)
//  - bypassing CoreApi for commercial routes (all /api/* routes go through CoreApi)
//
// Phase 2C.3.4: the test now matches what it actually claims. The old test
// claimed "cannot import repositories directly" but only checked for
// `persistence/repositories` — not the barrel `@contractor/core/persistence`.
// This was a false enforcement. The test now correctly checks for SQL, pricing,
// and direct audit mutation (the actual prohibited behaviors) rather than
// repository imports (which are composition-root-legal).

describe('architecture: web-host contains no SQL / pricing / direct audit mutation', () => {
  it('web-host does NOT contain raw SQL, pricing formulas, or direct audit mutation', () => {
    const hostDir = join(REPO_ROOT, 'packages', 'web-host', 'src')
    const hostFiles = readFiles(hostDir)
    const pricingRe = /\b(totalCost|sellPrice|grossProfit|grossMargin|overhead|contingency)\s*=\s*[^=]/
    const auditRe = /AuditRepository\s*\(|\.append\s*\(\s*\)/
    const sqlRe = /['"`]\s*(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|SELECT\s+[\s\S]*?\s+FROM)/i
    const violations = hostFiles.filter((f) => {
      const lines = nonCommentLines(f.content)
      return lines.some((line) =>
        pricingRe.test(line) || auditRe.test(line) || sqlRe.test(line),
      )
    })
    expect(violations.map((v) => v.rel)).toEqual([])
  })
})

/**
 * Regression: a future web-host module that reintroduces raw SQL should be caught.
 */
describe('architecture: web-host SQL boundary regression', () => {
  it('would catch a future module with raw SQL', () => {
    const sqlRe = /['"`]\s*(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|SELECT\s+[\s\S]*?\s+FROM)/i
    const fakeModule = "await db.execute(`INSERT INTO users VALUES (...)`)"
    const lines = nonCommentLines(fakeModule)
    expect(lines.some((line) => sqlRe.test(line))).toBe(true)
  })
  it('would NOT flag a repository method call (no SQL string literal)', () => {
    const sqlRe = /['"`]\s*(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|SELECT\s+[\s\S]*?\s+FROM)/i
    const fakeModule = "await users.createWithPassword(user, hash)"
    const lines = nonCommentLines(fakeModule)
    expect(lines.some((line) => sqlRe.test(line))).toBe(false)
  })
})
