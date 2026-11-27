/**
 * The only way a collector reads an agent's database: named columns of named
 * tables, read-only, from an allow-list that may never name a credential.
 * Agents keep login tokens in the same file as their usage, so a query is
 * built here from the allow-list rather than written by the collector.
 */

import { constants, Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

export type AllowList = Readonly<Record<string, readonly string[]>>;

const NEVER_READ_TABLES = ["account", "control_account", "credential", "session_share"];
const NEVER_READ_COLUMN = /token$|secret|credential|password|api_?key|^value$/i;

export function assertNoCredentials(allowList: AllowList): void {
  for (const [table, columns] of Object.entries(allowList)) {
    if (NEVER_READ_TABLES.includes(table.toLowerCase()))
      throw new Error(`table ${table} holds credentials and is never read`);
    const secret = columns.find((column) => NEVER_READ_COLUMN.test(column));
    if (secret) throw new Error(`column ${table}.${secret} is never read`);
  }
}

export interface ResumeAfter {
  orderColumn: string;
  idColumn: string;
  order: number | string;
  id: number | string;
}

/**
 * A read-only connection to a WAL database must create its -shm file, which it
 * may not, once the writer has exited and removed -wal and -shm. With no -wal
 * nothing is pending, so the file can be read as immutable.
 */
function openWithoutWriting(dbPath: string): Database {
  if (existsSync(`${dbPath}-wal`)) return new Database(dbPath, { readonly: true });

  return new Database(
    `${pathToFileURL(dbPath).href}?immutable=1`,
    constants.SQLITE_OPEN_READONLY | constants.SQLITE_OPEN_URI
  );
}

function quoted(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function allowedColumns(allowList: AllowList, table: string, columns: readonly string[]) {
  const allowed = allowList[table];
  if (!allowed) throw new Error(`table ${table} is not on the allow-list`);
  const stray = columns.find((column) => !allowed.includes(column));
  if (stray) throw new Error(`column ${table}.${stray} is not on the allow-list`);
}

export function selectAllowed<Row>(
  dbPath: string,
  allowList: AllowList,
  table: string,
  columns: readonly string[],
  after: ResumeAfter
): Row[] {
  assertNoCredentials(allowList);
  allowedColumns(allowList, table, [...columns, after.orderColumn, after.idColumn]);
  const order = quoted(after.orderColumn);
  const id = quoted(after.idColumn);
  const sql = `SELECT ${columns.map(quoted).join(", ")} FROM ${quoted(table)} WHERE ${order} > ?1 OR (${order} = ?1 AND ${id} > ?2) ORDER BY ${order}, ${id}`;
  const db = openWithoutWriting(dbPath);

  try {
    return db
      .query<Row, [number | string, number | string]>(sql)
      .all(after.order, after.id);
  } finally {
    db.close();
  }
}
