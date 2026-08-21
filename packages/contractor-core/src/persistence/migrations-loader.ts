/**
 * Migration SQL loader — separated from the persistence barrel to avoid
 * pulling PgLiteClient (and @electric-sql/pglite WASM) into the Vercel
 * serverless function bundle.
 *
 * The SQL content is inlined in `migrations-generated.ts` (auto-generated from
 * the .sql files in `migrations/`). This avoids runtime `readFileSync` calls
 * that would fail in the Vercel serverless environment (where only the bundled
 * .mjs is deployed, not the .sql files). Regenerate with `bun run inline:migrations`.
 */

export {
  FOUNDATION_MIGRATION_SQL,
  COMMERCIAL_MIGRATION_SQL,
  MAGIC_LINKS_MIGRATION_SQL,
  AUTH_MIGRATION_SQL,
} from './migrations-generated.js'
