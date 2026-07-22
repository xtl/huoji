import { Global, Module, OnApplicationShutdown } from '@nestjs/common';
import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

type QueryParams = readonly unknown[];

export const DB_TOKEN = Symbol('DB_TOKEN');

export class DatabaseService implements OnApplicationShutdown {
  private readonly pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ?? 'postgres://huoji:huoji@localhost:5432/huoji',
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  });

  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: QueryParams = [],
  ): Promise<QueryResult<T>> {
    return this.pool.query<T>(text, [...params]);
  }

  async one<T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: QueryParams = [],
  ): Promise<T | null> {
    const result = await this.query<T>(text, params);
    return result.rows[0] ?? null;
  }

  async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const value = await fn(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [DatabaseService],
  exports: [DatabaseService],
})
export class DatabaseModule {}
