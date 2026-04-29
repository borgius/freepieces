// Hand-written types for the native cloudflare-d1 piece.

export interface CloudflareD1BindingInput {
  /** Worker D1 binding name. Defaults to DB. */
  databaseBinding?: string;
}

export interface CloudflareD1StatementInput extends CloudflareD1BindingInput {
  /** SQL statement. Use ? placeholders and pass values in params. */
  sql: string;
  /** Values bound to SQL ? placeholders. */
  params?: unknown[];
}

export interface CloudflareD1FirstInput extends CloudflareD1StatementInput {
  /** Optional column name to return from the first row. */
  columnName?: string;
}

export interface CloudflareD1Result<T = Record<string, unknown>> {
  success: true;
  results: T[];
  meta: Record<string, unknown>;
}

export interface CloudflareD1FirstOutput<T = unknown> {
  result: T | null;
}

export interface CloudflareD1Client {
  /** Run a SELECT-style D1 prepared statement and return all rows. */
  query<T = Record<string, unknown>>(input: CloudflareD1StatementInput): Promise<CloudflareD1Result<T>>;
  /** Run a D1 prepared statement and return the first row or column value. */
  first<T = Record<string, unknown>>(input: CloudflareD1FirstInput): Promise<CloudflareD1FirstOutput<T>>;
  /** Run an INSERT, UPDATE, DELETE, or DDL D1 prepared statement. */
  execute<T = Record<string, unknown>>(input: CloudflareD1StatementInput): Promise<CloudflareD1Result<T>>;
}
