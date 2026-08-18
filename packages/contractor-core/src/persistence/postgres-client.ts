/**
 * PostgresClient — standalone PostgreSQL via `pg` (node-postgres).
 *
 * For PRODUCTION deployments against a standalone PostgreSQL server.
 *
 * NOT VERIFIED in this environment (no standalone PostgreSQL server
 * available). The SQL + repository logic is verified via PgLiteClient
 * (real PostgreSQL WASM) in integration tests; this client is a thin
 * transport adapter over the same SQL.
 *
 * Usage:
 *   const pool = new Pool({ connectionString: process.env.DATABASE_URL })
 *   const db = new PostgresClient(pool)
 *
 * Credentials must come from the environment / secret manager, never from
 * source. (architecture/LICENSING.md §7; master prompt §39.)
 */

import type { Pool, PoolClient } from 'pg'
import type { DbClient, DbRow } from './db-client.js'

export class PostgresClient implements DbClient {
  private readonly pool: Pool
  private client: PoolClient | null = null
  private txDepth = 0

  constructor(pool: Pool) {
    this.pool = pool
  }

  private async getClient(): Promise<PoolClient> {
    if (!this.client) {
      this.client = await this.pool.connect()
    }
    return this.client
  }

  async query<T extends DbRow = DbRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    const client = await this.getClient()
    const result = await client.query(sql, params as unknown[])
    return result.rows as T[]
  }

  async execute(sql: string, params: unknown[] = []): Promise<{ affectedRows: number }> {
    const client = await this.getClient()
    const result = await client.query(sql, params as unknown[])
    return { affectedRows: result.rowCount ?? 0 }
  }

  async queryReturning<T extends DbRow = DbRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.query<T>(sql, params)
  }

  async tx<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
    const savepoint = `sp_${this.txDepth}`
    const client = await this.getClient()
    if (this.txDepth === 0) {
      await client.query('BEGIN')
    } else {
      await client.query(`SAVEPOINT ${savepoint}`)
    }
    this.txDepth++
    try {
      const result = await fn(this)
      if (this.txDepth === 1) {
        await client.query('COMMIT')
      } else {
        await client.query(`RELEASE SAVEPOINT ${savepoint}`)
      }
      return result
    } catch (e) {
      if (this.txDepth === 1) {
        await client.query('ROLLBACK')
      } else {
        await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
        await client.query(`RELEASE SAVEPOINT ${savepoint}`)
      }
      throw e
    } finally {
      this.txDepth--
    }
  }

  async close(): Promise<void> {
    if (this.client) this.client.release()
  }

  async execRaw(sql: string): Promise<void> {
    // node-postgres handles multi-statement SQL via client.query
    const client = await this.getClient()
    await client.query(sql)
  }
}
