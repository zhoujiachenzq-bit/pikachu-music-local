interface SqlJs { Database: new (data?: Uint8Array) => unknown }
type InitSqlJs = (config?: { locateFile?: (file: string) => string }) => Promise<SqlJs>;

declare module 'sql.js' { const initSqlJs: InitSqlJs; export default initSqlJs; }
declare module 'sql.js/dist/sql-wasm.js' { const initSqlJs: InitSqlJs; export default initSqlJs; }
