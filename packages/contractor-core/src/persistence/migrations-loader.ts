/**
 * Migration SQL loader — separated from the persistence barrel to avoid
 * pulling PgLiteClient (and @electric-sql/pglite WASM) into the Vercel
 * serverless function bundle.
 *
 * The barrel export at persistence/index.ts re-exports PgLiteClient, which
 * imports @electric-sql/pglite — a WASM module Vercel's esbuild bundler
 * cannot handle. By importing the migration SQL from this separate module,
 * the Vercel handler's import graph never touches pglite.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const FOUNDATION_MIGRATION_SQL = readFileSync(
  join(__dirname, 'migrations/0001_foundation.sql'),
  'utf8',
)
export const COMMERCIAL_MIGRATION_SQL = readFileSync(
  join(__dirname, 'migrations/0002_commercial.sql'),
  'utf8',
)
export const MAGIC_LINKS_MIGRATION_SQL = readFileSync(
  join(__dirname, 'migrations/0003_magic_links.sql'),
  'utf8',
)
export const AUTH_MIGRATION_SQL = readFileSync(
  join(__dirname, 'migrations/0004_auth.sql'),
  'utf8',
)
