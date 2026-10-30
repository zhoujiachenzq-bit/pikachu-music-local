// Gives sql.js the node:sqlite surface that src/server uses, so the same SQL runs
// on the phone. Statements are prepared per call because export() closes them.
export interface SqlJsStatement {
  bind(values: unknown[]): boolean; step(): boolean; getAsObject(): Record<string, unknown>; free(): boolean;
}
export interface SqlJsDatabase {
  prepare(sql: string): SqlJsStatement; run(sql: string, values?: unknown[]): unknown; exec(sql: string): unknown;
  getRowsModified(): number; export(): Uint8Array;
}

export class PhoneDatabase {
  constructor(private db: SqlJsDatabase, private onChange: () => void = () => undefined) {}

  exec(sql: string) {
    // A WAL flag in the saved file makes the next launch hang: the in-memory
    // filesystem has no shared memory for SQLite to reopen it with.
    this.db.exec(sql.replace(/PRAGMA journal_mode\s*=\s*WAL;/i, ''));
    if (!/^\s*PRAGMA/i.test(sql)) this.onChange();
  }

  prepare(sql: string) {
    const db = this.db;
    const read = <T>(values: unknown[], collect: (statement: SqlJsStatement) => T) => {
      const statement = db.prepare(sql);
      try { statement.bind(values); return collect(statement); } finally { statement.free(); }
    };
    return {
      get: (...values: unknown[]) => read(values, statement => statement.step() ? statement.getAsObject() : undefined),
      all: (...values: unknown[]) => read(values, statement => {
        const rows: Record<string, unknown>[] = [];
        while (statement.step()) rows.push(statement.getAsObject());
        return rows;
      }),
      run: (...values: unknown[]) => {
        db.run(sql, values); const changes = db.getRowsModified();
        if (changes) this.onChange();
        return { changes, lastInsertRowid: 0 };
      }
    };
  }

  // export() reopens the database, which turns foreign keys back off.
  snapshot() {
    const bytes = this.db.export();
    this.db.exec('PRAGMA foreign_keys = ON;');
    return bytes;
  }

  close() { return undefined; }
}
