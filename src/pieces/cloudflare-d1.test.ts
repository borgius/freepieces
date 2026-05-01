import { describe, expect, it } from 'vitest';

import { cloudflareD1Piece } from './cloudflare-d1';
import type { Env } from '../framework/types';

class FakeD1Statement {
  public readonly bound: unknown[][] = [];

  constructor(private readonly sql: string) {}

  bind(...values: unknown[]): FakeD1Statement {
    this.bound.push(values);
    return this;
  }

  async all() {
    return {
      success: true,
      results: [{ id: 1, name: 'Ada' }],
      meta: { sql: this.sql, params: this.bound.at(-1) ?? [] },
    };
  }

  async first(columnName?: string) {
    const row = { id: 1, name: 'Ada' };
    return columnName ? row[columnName as keyof typeof row] : row;
  }

  async run() {
    return {
      success: true,
      results: [],
      meta: { changes: 1, sql: this.sql, params: this.bound.at(-1) ?? [] },
    };
  }
}

class FakeD1Database {
  public readonly statements: FakeD1Statement[] = [];

  prepare(sql: string): FakeD1Statement {
    const statement = new FakeD1Statement(sql);
    this.statements.push(statement);
    return statement;
  }
}

function createEnv(db = new FakeD1Database()): Env {
  return { DB: db } as unknown as Env;
}

function getAction(name: string) {
  const action = cloudflareD1Piece.actions.find((entry) => entry.name === name);
  if (!action) throw new Error(`Missing action ${name}`);
  return action;
}

describe('cloudflareD1Piece', () => {
  it('defines a no-auth Cloudflare D1 piece', () => {
    expect(cloudflareD1Piece.name).toBe('cloudflare-d1');
    expect(cloudflareD1Piece.auth.type).toBe('none');
    expect(cloudflareD1Piece.actions.map((action) => action.name)).toEqual(['query', 'first', 'execute']);
  });

  it('runs query with positional params against the default DB binding', async () => {
    const db = new FakeD1Database();
    const result = await getAction('query').run({
      env: createEnv(db),
      props: { sql: 'select * from users where id = ?', params: [1] },
    });

    expect(db.statements[0]?.bound).toEqual([[1]]);
    expect(result).toEqual({
      success: true,
      results: [{ id: 1, name: 'Ada' }],
      meta: { sql: 'select * from users where id = ?', params: [1] },
    });
  });

  it('can use a custom D1 binding and return a first column value', async () => {
    const env = { ANALYTICS_DB: new FakeD1Database() } as unknown as Env;
    const result = await getAction('first').run({
      env,
      props: {
        databaseBinding: 'ANALYTICS_DB',
        sql: 'select name from users where id = ?',
        params: [1],
        columnName: 'name',
      },
    });

    expect(result).toEqual({ result: 'Ada' });
  });

  it('rejects non-array params', async () => {
    await expect(getAction('execute').run({
      env: createEnv(),
      props: { sql: 'insert into users(name) values (?)', params: 'Ada' },
    })).rejects.toThrow('params must be an array');
  });

  it('throws when the requested binding is missing', async () => {
    await expect(getAction('query').run({
      env: createEnv(),
      props: { databaseBinding: 'MISSING_DB', sql: 'select 1' },
    })).rejects.toThrow('D1 binding "MISSING_DB" was not found');
  });
});
