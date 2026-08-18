/**
 * DbClient — the persistence port. A thin database-agnostic query interface.
 *
 * Two implementations:
 *  - PgLiteClient  — real PostgreSQL (WASM) via @electric-sql/pglite. For tests.
 *  - PostgresClient — standalone PostgreSQL via `pg`. For production.
 *
 * Both execute the same parameterized SQL ($1, $2, ...) against real
 * PostgreSQL. Repositories use DbClient and are agnostic to which
 * implementation is active. (architecture/BOUNDARIES.md §4.)
 *
 * This is NOT a mock — pglite IS real PostgreSQL (PostgreSQL 16 compiled to
 * WASM). Integration tests against pglite exercise real PostgreSQL semantics.
 */

export interface DbRow {
  readonly [column: string]: unknown
}

export interface DbClient {
  /**
   * Execute a query that returns rows (SELECT). Parameters use PostgreSQL
   * positional placeholders ($1, $2, ...).
   */
  query<T extends DbRow = DbRow>(sql: string, params?: unknown[]): Promise<T[]>

  /**
   * Execute a statement that modifies rows (INSERT/UPDATE/DELETE).
   * Returns the number of affected rows.
   */
  execute(sql: string, params?: unknown[]): Promise<{ affectedRows: number }>

  /**
   * Execute a statement that returns rows AND a count (INSERT ... RETURNING).
   * Convenience: same as query but semantically a mutation.
   */
  queryReturning<T extends DbRow = DbRow>(sql: string, params?: unknown[]): Promise<T[]>

  /**
   * Run a function inside a transaction. If the function throws, the
   * transaction is rolled back. Otherwise it is committed.
   * Nested transactions are supported via SAVEPOINT.
   */
  tx<T>(fn: (tx: DbClient) => Promise<T>): Promise<T>

  /**
   * Execute raw (possibly multi-statement) SQL, typically DDL for migrations.
   * Implementations use the driver's native multi-statement execution which
   * handles dollar-quoted strings ($$ ... $$) correctly.
   */
  execRaw(sql: string): Promise<void>
}

/**
 * Apply a SQL migration (DDL) to a DbClient. Uses the driver's native
 * multi-statement execution (handles dollar-quoted trigger/function bodies).
 */
export async function applyMigration(db: DbClient, sql: string): Promise<void> {
  await db.execRaw(sql)
}
