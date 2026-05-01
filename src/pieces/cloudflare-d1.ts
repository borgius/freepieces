import { createPiece } from '../framework/piece';
import type { Env, PieceActionContext, PropDefinition } from '../framework/types';

const DEFAULT_D1_BINDING = 'DB';

const databaseBindingProp: PropDefinition = {
  type: 'SHORT_TEXT',
  displayName: 'D1 binding name',
  description: `Worker binding name for the D1 database. Defaults to ${DEFAULT_D1_BINDING}.`,
  required: false,
  defaultValue: DEFAULT_D1_BINDING,
};

const sqlProp: PropDefinition = {
  type: 'LONG_TEXT',
  displayName: 'SQL',
  description: 'SQL statement to execute. Use ? placeholders and pass values in params.',
  required: true,
};

const paramsProp: PropDefinition = {
  type: 'JSON',
  displayName: 'Params',
  description: 'Array of values bound to SQL ? placeholders.',
  required: false,
};

function getProps(ctx: PieceActionContext): Record<string, unknown> {
  return ctx.props ?? {};
}

function readString(props: Record<string, unknown>, key: string): string {
  const value = props[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function readParams(props: Record<string, unknown>): unknown[] {
  const params = props['params'];
  if (params == null) return [];
  if (!Array.isArray(params)) throw new Error('params must be an array');
  return params;
}

function getD1Database(env: Env, props: Record<string, unknown>): D1Database {
  const bindingName = typeof props['databaseBinding'] === 'string' && props['databaseBinding'].trim()
    ? props['databaseBinding'].trim()
    : DEFAULT_D1_BINDING;
  const binding = env[bindingName];
  if (!binding || typeof (binding as D1Database).prepare !== 'function') {
    throw new Error(`D1 binding "${bindingName}" was not found`);
  }
  return binding as D1Database;
}

async function query(ctx: PieceActionContext): Promise<unknown> {
  const props = getProps(ctx);
  const db = getD1Database(ctx.env, props);
  const statement = db.prepare(readString(props, 'sql')).bind(...readParams(props));
  return statement.all();
}

async function first(ctx: PieceActionContext): Promise<unknown> {
  const props = getProps(ctx);
  const db = getD1Database(ctx.env, props);
  const statement = db.prepare(readString(props, 'sql')).bind(...readParams(props));
  const columnName = props['columnName'];
  return {
    result: typeof columnName === 'string' && columnName.trim()
      ? await statement.first(columnName.trim())
      : await statement.first(),
  };
}

async function execute(ctx: PieceActionContext): Promise<unknown> {
  const props = getProps(ctx);
  const db = getD1Database(ctx.env, props);
  const statement = db.prepare(readString(props, 'sql')).bind(...readParams(props));
  return statement.run();
}

export const cloudflareD1Piece = createPiece({
  name: 'cloudflare-d1',
  displayName: 'Cloudflare D1',
  description: 'Run parameterized SQL queries against a Cloudflare D1 binding.',
  version: '0.1.0',
  auth: { type: 'none' },
  actions: [
    {
      name: 'query',
      displayName: 'Query Rows',
      description: 'Run a SELECT-style D1 prepared statement and return all rows.',
      props: { databaseBinding: databaseBindingProp, sql: sqlProp, params: paramsProp },
      run: query,
    },
    {
      name: 'first',
      displayName: 'Get First Row',
      description: 'Run a D1 prepared statement and return the first row or column value.',
      props: {
        databaseBinding: databaseBindingProp,
        sql: sqlProp,
        params: paramsProp,
        columnName: {
          type: 'SHORT_TEXT',
          displayName: 'Column name',
          description: 'Optional column name to return from the first row.',
          required: false,
        },
      },
      run: first,
    },
    {
      name: 'execute',
      displayName: 'Execute Statement',
      description: 'Run an INSERT, UPDATE, DELETE, or DDL D1 prepared statement.',
      props: { databaseBinding: databaseBindingProp, sql: sqlProp, params: paramsProp },
      run: execute,
    },
  ],
});
