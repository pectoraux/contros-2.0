/**
 * PgLiteClient — real PostgreSQL (WASM) via @electric-sql/pglite.
 *
 * Used for integration tests. This is NOT a mock — pglite is PostgreSQL 16
 * compiled to WASM. Tests against this client exercise real PostgreSQL
 * semantics (constraints, transactions, row-level operations, tenant
 * isolation via WHERE clauses, immutability).
 *
 * Apache-2.0 license (passes the fork's license gate).
 */

import { PGlite } from '@electric-sql/pglite'
import type { DbClient, DbRow } from './db-client.js'

interface PgLiteTxState {
  depth: number
}

export class PgLiteClient implements DbClient {
  private readonly pg: PGlite
  private readonly txState: PgLiteTxState = { depth: 0 }

  constructor(pg?: PGlite) {
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

  async tx<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    const savepoint = `sp_${this.txState.depth}`
    if (this.txState.depth === 0) {
      await this.pg.query('BEGIN')
    } else {
      await this.pg.query(`SAVEPOINT ${savepoint}`)
    }
    this.txState.depth++
    try {
      const result = await fn(this)
      if (this.txState.depth === 1) {
        await this.pg.query('COMMIT')
      } else {
        await this.pg.query(`RELEASE SAVEPOINT ${savepoint}`)
      }
      return result
    } catch (e) {
      if (this.txState.depth === 1) {
        await this.pg.query('ROLLBACK')
      } else {
        await this.pg.query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
        await this.pg.query(`RELEASE SAVEPOINT ${savepoint}`)
      }
      throw e
    } finally {
      this.txState.depth--
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
