/**
 * PostgresClient — standalone PostgreSQL via `pg` (node-postgres).
 *
 * For PRODUCTION deployments against a standalone PostgreSQL server
 * (e.g. Neon, Supabase, RDS). The `pg.Pool` handles connection pooling.
 *
 * Phase 2C.2 BUG FIX: the previous implementation cached a single `PoolClient`
 * on the instance (`this.client`) and never released it. In a serverless
 * function (Vercel) this would:
 *  - exhaust the connection pool under load (each invocation holds a
 *    connection forever)
 *  - leak `txDepth` across concurrent invocations if the instance is reused
 *    as a module global (two concurrent requests would corrupt each other's
 *    transaction state).
 *
 * The fix: check out a connection per `tx()` call and release it in `finally`.
 * Non-transactional queries (`query`/`execute`/`execRaw`) check out a
 * connection per-call, use it, and release it immediately. The instance
 * carries NO mutable connection state — it is safe to reuse as a module
 * global across concurrent serverless invocations.
 *
 * Runtime-verified (Phase 2C.2): `tests/integration/postgres-client.test.ts`
 * runs the full repository + service suite against a real PostgreSQL when
 * `DATABASE_URL` is set; skipped otherwise (PGlite remains the test substrate
 * for the rest of the suite).
 *
 * Credentials must come from the environment / secret manager, never from
 * source. (architecture/LICENSING.md §7; master prompt §39.)
 */

import type { Pool, PoolClient } from 'pg'
import type { DbClient, DbRow } from './db-client.js'

export class PostgresClient implements DbClient {
  private readonly pool: Pool

  constructor(pool: Pool) {
    this.pool = pool
  }

  /**
   * Check out a connection for a single non-transactional query, then release
   * it immediately. The instance never holds a connection between calls.
   */
  async query<T extends DbRow = DbRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    const client = await this.pool.connect()
    try {
      const result = await client.query(sql, params as unknown[])
      return result.rows as T[]
    } finally {
      client.release()
    }
  }

  async execute(sql: string, params: unknown[] = []): Promise<{ affectedRows: number }> {
    const client = await this.pool.connect()
    try {
      const result = await client.query(sql, params as unknown[])
      return { affectedRows: result.rowCount ?? 0 }
    } finally {
      client.release()
    }
  }

  async queryReturning<T extends DbRow = DbRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.query<T>(sql, params)
  }

  /**
   * Run a function inside a transaction. A single connection is checked out
   * for the duration of the transaction (BEGIN … COMMIT/ROLLBACK) and
   * released in `finally`. The instance carries NO transaction state —
   * `txDepth` is a local variable, not instance state, so concurrent
   * invocations on a shared module-global `PostgresClient` do not corrupt
   * each other.
   *
   * Nested `tx()` calls (a tx within a tx) use SAVEPOINT on the SAME checked-out
   * connection. The connection is released only when the outermost tx commits
   * or rolls back. This is correct PostgreSQL nesting behavior.
   */
  async tx<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    // A per-invocation txDepth — NOT instance state. Safe for concurrent use.
    let depth = 0
    const savepoints: string[] = []
    try {
      await client.query('BEGIN')
      depth = 1
      const nestedClient: DbClient = {
        query: async <U extends DbRow = DbRow>(sql: string, params: unknown[] = []): Promise<U[]> => {
          const result = await client.query(sql, params as unknown[])
          return result.rows as U[]
        },
        execute: async (sql: string, params: unknown[] = []): Promise<{ affectedRows: number }> => {
          const result = await client.query(sql, params as unknown[])
          return { affectedRows: result.rowCount ?? 0 }
        },
        queryReturning: async <U extends DbRow = DbRow>(sql: string, params: unknown[] = []): Promise<U[]> => {
          const result = await client.query(sql, params as unknown[])
          return result.rows as U[]
        },
        tx: async <U>(nestedFn: (tx: DbClient) => Promise<U>): Promise<U> => {
          const sp = `sp_${depth}`
          savepoints.push(sp)
          await client.query(`SAVEPOINT ${sp}`)
          depth++
          try {
            const result = await nestedFn(nestedClient)
            await client.query(`RELEASE SAVEPOINT ${sp}`)
            depth--
            return result
          } catch (e) {
            await client.query(`ROLLBACK TO SAVEPOINT ${sp}`)
            await client.query(`RELEASE SAVEPOINT ${sp}`)
            depth--
            throw e
          }
        },
        execRaw: async (sql: string): Promise<void> => {
          await client.query(sql)
        },
      }
      const result = await fn(nestedClient)
      await client.query('COMMIT')
      return result
    } catch (e) {
      try {
        if (depth > 0) {
          await client.query('ROLLBACK')
        }
      } catch {
        // If rollback fails (e.g. connection already aborted), the original
        // error is what matters.
      }
      throw e
    } finally {
      client.release()
    }
  }

  async close(): Promise<void> {
    // The instance holds no connection; the pool is closed by the caller.
    // (Closing the pool here would break shared-pool usage.)
  }

  async execRaw(sql: string): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query(sql)
    } finally {
      client.release()
    }
  }
}
