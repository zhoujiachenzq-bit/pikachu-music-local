/// <reference types="vite/client" />
import initSqlJs from 'sql.js/dist/sql-wasm.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { PhoneDatabase, type SqlJsDatabase } from '../sqliteAdapter';

const SAVE_DELAY_MS = 1500;
const STORE = 'files'; const KEY = 'music-house.sqlite';
let opened: PhoneDatabase | null = null;

function openStore() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('music-house', 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function storeRequest<T>(store: IDBDatabase, mode: IDBTransactionMode, run: (files: IDBObjectStore) => IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    const request = run(store.transaction(STORE, mode).objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Must finish before createDatabase() runs: it opens the database synchronously.
export async function openPhoneDatabase() {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const store = await openStore();
  const saved = await storeRequest<Uint8Array | undefined>(store, 'readonly', files => files.get(KEY));
  let timer: number | undefined;
  const save = () => {
    window.clearTimeout(timer); timer = undefined;
    if (opened) void storeRequest(store, 'readwrite', files => files.put(opened!.snapshot(), KEY)).catch(error => console.error(error));
  };
  opened = new PhoneDatabase(new SQL.Database(saved) as SqlJsDatabase, () => { timer ??= window.setTimeout(save, SAVE_DELAY_MS); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && timer !== undefined) save(); });
}

export function DatabaseSync() {
  if (!opened) throw new Error('手机数据库尚未打开。');
  return opened;
}
