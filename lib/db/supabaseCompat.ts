import { Pool, type QueryResultRow } from 'pg';

type DbError = { message: string };
type OrderBy = { column: string; ascending: boolean };
type FilterOp = 'eq' | 'ilike' | 'in' | 'gt';
type PendingWrite =
  | { kind: 'insert'; values: Record<string, unknown>[] }
  | { kind: 'update'; values: Record<string, unknown> }
  | { kind: 'delete' }
  | { kind: 'upsert'; values: Record<string, unknown> | Record<string, unknown>[]; onConflict?: string };

function quoteIdent(ident: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(ident)) {
    throw new Error(`Unsafe SQL identifier: ${ident}`);
  }
  return `"${ident}"`;
}

function parseSelect(selectText: string): string[] {
  return selectText.split(',').map((s) => s.trim()).filter(Boolean);
}

function normalizeExpression(expr: string): string {
  // Supabase-style JSON path filters come in like:
  //   generated_json->meta->>hotel_code
  // Postgres SQL needs quoted JSON keys:
  //   generated_json->'meta'->>'hotel_code'
  if (!expr.includes('->')) return expr;
  const parts = expr.split('->').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return expr;
  const [base, ...rest] = parts;
  let sql = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(base) ? quoteIdent(base) : base;
  for (const token of rest) {
    if (token.startsWith('>')) {
      const key = token.slice(1).trim();
      sql += `->>'${key}'`;
    } else {
      sql += `->'${token}'`;
    }
  }
  return sql;
}

class QueryBuilder<T extends QueryResultRow = QueryResultRow> implements PromiseLike<{ data: T[] | null; error: DbError | null }> {
  private selected: string[] | null = null;
  private filters: Array<{ expr: string; op: FilterOp; value: unknown }> = [];
  private orderBy: OrderBy | null = null;
  private limitCount: number | null = null;
  private singleMode: 'single' | 'maybeSingle' | null = null;
  private pendingWrite: PendingWrite | null = null;

  constructor(private readonly pool: Pool, private readonly table: string) {}

  select(columns: string) { this.selected = parseSelect(columns); return this; }
  insert(values: Record<string, unknown> | Record<string, unknown>[]) { this.pendingWrite = { kind: 'insert', values: Array.isArray(values) ? values : [values] }; return this; }
  update(values: Record<string, unknown>) { this.pendingWrite = { kind: 'update', values }; return this; }
  delete() { this.pendingWrite = { kind: 'delete' }; return this; }
  upsert(values: Record<string, unknown> | Record<string, unknown>[], options?: { onConflict?: string }) { this.pendingWrite = { kind: 'upsert', values, onConflict: options?.onConflict }; return this; }
  eq(column: string, value: unknown) { this.filters.push({ expr: column, op: 'eq', value }); return this; }
  ilike(column: string, value: unknown) { this.filters.push({ expr: column, op: 'ilike', value }); return this; }
  in(column: string, value: unknown[]) { this.filters.push({ expr: column, op: 'in', value }); return this; }
  gt(column: string, value: unknown) { this.filters.push({ expr: column, op: 'gt', value }); return this; }
  filter(expr: string, op: 'eq', value: unknown) { this.filters.push({ expr, op, value }); return this; }
  order(column: string, options?: { ascending?: boolean }) { this.orderBy = { column, ascending: options?.ascending !== false }; return this; }
  limit(n: number) { this.limitCount = n; return this; }

  async single(): Promise<{ data: T | null; error: DbError | null }> {
    this.singleMode = 'single';
    const result = await this.execute();
    return { data: result.data?.[0] ?? null, error: result.error };
  }

  async maybeSingle(): Promise<{ data: T | null; error: DbError | null }> {
    this.singleMode = 'maybeSingle';
    const result = await this.execute();
    return { data: result.data?.[0] ?? null, error: result.error };
  }

  then<TResult1 = { data: T[] | null; error: DbError | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: T[] | null; error: DbError | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private buildWhere(params: unknown[]): string {
    if (this.filters.length === 0) return '';
    const parts = this.filters.map((f) => {
      const idx = params.push(f.value);
      const left = normalizeExpression(f.expr);
      if (f.op === 'eq') return `${left} = $${idx}`;
      if (f.op === 'ilike') return `${left} ILIKE $${idx}`;
      if (f.op === 'gt') return `${left} > $${idx}`;
      return `${left} = ANY($${idx})`;
    });
    return ` WHERE ${parts.join(' AND ')}`;
  }

  private async execute(): Promise<{ data: T[] | null; error: DbError | null }> {
    try {
      const params: unknown[] = [];
      const tableSql = quoteIdent(this.table);
      let sql = '';

      if (!this.pendingWrite) {
        const selectSql = this.selected && this.selected.length > 0
          ? this.selected.map((c) => (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(c) ? quoteIdent(c) : c)).join(', ')
          : '*';
        sql = `SELECT ${selectSql} FROM ${tableSql}`;
        sql += this.buildWhere(params);
        if (this.orderBy) sql += ` ORDER BY ${quoteIdent(this.orderBy.column)} ${this.orderBy.ascending ? 'ASC' : 'DESC'}`;
        if (this.limitCount !== null) { const limIdx = params.push(this.limitCount); sql += ` LIMIT $${limIdx}`; }
      } else if (this.pendingWrite.kind === 'delete') {
        sql = `DELETE FROM ${tableSql}`;
        sql += this.buildWhere(params);
      } else if (this.pendingWrite.kind === 'update') {
        const entries = Object.entries(this.pendingWrite.values);
        const setSql = entries.map(([k, v]) => { const idx = params.push(v); return `${quoteIdent(k)} = $${idx}`; }).join(', ');
        sql = `UPDATE ${tableSql} SET ${setSql}`;
        sql += this.buildWhere(params);
      } else {
        const rows = Array.isArray(this.pendingWrite.values) ? this.pendingWrite.values : [this.pendingWrite.values];
        if (rows.length === 0) return { data: [], error: null };
        const columns = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
        const colSql = columns.map(quoteIdent).join(', ');
        const valueSql = rows.map((row) => {
          const placeholders = columns.map((c) => { const idx = params.push((row as Record<string, unknown>)[c] ?? null); return `$${idx}`; });
          return `(${placeholders.join(', ')})`;
        }).join(', ');

        sql = `INSERT INTO ${tableSql} (${colSql}) VALUES ${valueSql}`;
        if (this.pendingWrite.kind === 'upsert') {
          const onConflict = this.pendingWrite.onConflict ?? 'id';
          const updateCols = columns.filter((c) => c !== onConflict);
          const setSql = updateCols.map((c) => `${quoteIdent(c)} = EXCLUDED.${quoteIdent(c)}`).join(', ');
          sql += ` ON CONFLICT (${quoteIdent(onConflict)}) DO UPDATE SET ${setSql}`;
        }
        if (this.selected && this.selected.length > 0) {
          sql += ` RETURNING ${this.selected.map((c) => (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(c) ? quoteIdent(c) : c)).join(', ')}`;
        }
      }

      const result = await this.pool.query<T>(sql, params);

      if (this.singleMode === 'single' && result.rows.length !== 1) {
        return { data: null, error: { message: `Expected 1 row, got ${result.rows.length}` } };
      }
      if (this.singleMode === 'maybeSingle' && result.rows.length > 1) {
        return { data: null, error: { message: `Expected 0 or 1 row, got ${result.rows.length}` } };
      }

      return { data: result.rows, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Database error';
      return { data: null, error: { message } };
    }
  }
}

export class PgSupabaseCompat {
  constructor(private readonly pool: Pool) {}
  from<T extends QueryResultRow = QueryResultRow>(table: string) { return new QueryBuilder<T>(this.pool, table); }
}

function buildPoolConfig(connectionString: string) {
  try {
    const url = new URL(connectionString);
    const host = (url.hostname || '').toLowerCase();
    const sslmode = (url.searchParams.get('sslmode') || '').toLowerCase();
    const isLocalHost = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    const disableSsl = isLocalHost || sslmode === 'disable';
    return disableSsl
      ? { connectionString }
      : { connectionString, ssl: { rejectUnauthorized: false } };
  } catch {
    return { connectionString, ssl: { rejectUnauthorized: false } };
  }
}

let pool: Pool | null = null;
const poolByConnectionString = new Map<string, Pool>();

export function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is not set. Add Neon pooled connection string to .env.local.');
    pool = new Pool(buildPoolConfig(connectionString));
  }
  return pool;
}

export function getPoolByConnectionString(connectionString: string) {
  const existing = poolByConnectionString.get(connectionString);
  if (existing) return existing;
  const created = new Pool(buildPoolConfig(connectionString));
  poolByConnectionString.set(connectionString, created);
  return created;
}
