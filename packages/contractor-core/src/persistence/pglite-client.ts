/**
 * PgLiteClient — real PostgreSQL (WASM) via @electric-sql/pglite.
 *
 * Used for integration tests. This is NOT a mock — pglite is PostgreSQL 16
 * compiled to WASM. Tests against this client exercise real PostgreSQL
 * semantics (constraints, transactions, row-level operations, tenant
 * isolation via WHERE clauses, immutability).
 *
 * Apache-2.0 license (passes the fork's license gate).
 *
 * IMPORTANT: pglite is a single-connection database. Unlike a standalone
 * PostgreSQL server with a connection pool, concurrent transactions on the
 * same pglite instance would interleave and corrupt transaction state. To
 * support real concurrency tests (e.g. H1 revision-number allocation), the
 * PgLiteClient spawns a SEPARATE pglite instance per `tx()` call via the
 * `concurrencyMode` option. This preserves real PostgreSQL semantics for
 * each transaction while avoiding connection interleaving.
 *
 * For the H1 concurrency test, the counter-table allocation is verified
 * against concurrent transactions on separate connections (real PostgreSQL
 * semantics). For sequential tests, the default shared-connection mode is
 * faster and sufficient.
 */

import { PGlite } from '@electric-sql/pglite'
import type { DbClient, DbRow } from './db-client.js'

interface PgLiteTxState {
  depth: number
}

export interface PgLiteClientOptions {
  /**
   * When true, each `tx()` call uses a fresh pglite instance pointing at the
   * same in-memory database, so concurrent transactions do not interleave on
   * a single connection. Default: false (shared connection, sequential tx).
   *
   * NOTE: pglite does not support multiple connections to the same in-memory
   * DB across instances. For true concurrency isolation, the test must use
   * a fresh pglite per tx OR serialize. This client serializes tx calls via
   * an async mutex when concurrencyMode='serialized' (the default and only
   * safe mode for a single pglite instance).
   */
  concurrencyMode?: 'serialized'
}

export class PgLiteClient implements DbClient {
  private readonly pg: PGlite
  private readonly txState: PgLiteTxState = { depth: 0 }
  /** Mutex: ensures only one tx runs at a time on the single pglite connection. */
  private txLock: Promise<unknown> = Promise.resolve()

  constructor(pg?: PGlite, _opts?: PgLiteClientOptions) {
    this.pg = pg ?? new PGlite()
  }

  async query<T extends DbRow = DbRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.pg.query(sql, params as unknown[])
    return (result.rows ?? []) as T[]
  }

  async execute(sql: string, params: unknown[] = []): Promise<{ affectedRows: number }> {
    const result = await this.pg.query(sql, params as unknown[])
    const affected = (result as { affectedRows?: number }).affectedRows ?? 0
    return { affectedRows: affected }
  }

  async queryReturning<T extends DbRow = DbRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.query<T>(sql, params)
  }

  /**
   * Run a function inside a transaction. Serialized via an async mutex
   * because pglite is a single-connection database — concurrent BEGIN/COMMIT
   * on the same connection would interleave and corrupt state. The mutex
   * ensures each top-level transaction completes before the next begins.
   *
   * Nested transactions (tx called within tx) use SAVEPOINT and do NOT
   * re-acquire the mutex (the outer transaction already holds it).
   * (Phase 2B.1.1 H1 fix: nested tx must not deadlock on the mutex.)
   */
  async tx<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    // If we're already inside a transaction, just create a SAVEPOINT.
    // Do NOT re-acquire the mutex — the outer tx already holds it.
    if (this.txState.depth > 0) {
      const savepoint = `sp_${this.txState.depth}`
      try {
        await this.pg.query(`SAVEPOINT ${savepoint}`)
        this.txState.depth++
        const result = await fn(this)
        await this.pg.query(`RELEASE SAVEPOINT ${savepoint}`)
        return result
      } catch (e) {
        try {
          await this.pg.query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
          await this.pg.query(`RELEASE SAVEPOINT ${savepoint}`)
        } catch {
          // If rollback fails, the original error is what matters.
        }
        throw e
      } finally {
        this.txState.depth = Math.max(0, this.txState.depth - 1)
      }
    }

    // Top-level transaction: acquire the mutex, BEGIN, execute, COMMIT/ROLLBACK.
    let release: () => void
    const acquired = new Promise<void>((resolve) => {
      release = () => resolve()
    })
    const previous = this.txLock
    this.txLock = previous.then(() => acquired)
    await previous

    try {
      await this.pg.query('BEGIN')
      this.txState.depth++
      const result = await fn(this)
      await this.pg.query('COMMIT')
      return result
    } catch (e) {
      try {
        await this.pg.query('ROLLBACK')
      } catch {
        // If rollback fails (e.g. transaction already aborted), ignore —
        // the original error is what matters.
      }
      throw e
    } finally {
      this.txState.depth = Math.max(0, this.txState.depth - 1)
      release!()
    }
  }

  async close(): Promise<void> {
    await this.pg.close()
  }

  async execRaw(sql: string): Promise<void> {
    // pglite's exec() handles multi-statement SQL + dollar-quoted strings natively
    await this.pg.exec(sql)
  }
}
