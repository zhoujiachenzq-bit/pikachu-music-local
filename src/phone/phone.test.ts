import { describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import { createNativeFetch, type NativeRequest } from './nativeFetch';
import Fastify from './shims/fastify';
import { PhoneDatabase, type SqlJsDatabase } from './sqliteAdapter';

describe('phone database', () => {
  const open = async (data?: Uint8Array, onChange?: () => void) => {
    const SQL = await initSqlJs();
    return new PhoneDatabase(new SQL.Database(data) as unknown as SqlJsDatabase, onChange);
  };

  it('answers like node:sqlite and keeps rows through a snapshot', async () => {
    const changes: number[] = []; const db = await open(undefined, () => changes.push(1));
    db.exec('CREATE TABLE items(id TEXT PRIMARY KEY, n INTEGER)');
    expect(db.prepare('INSERT INTO items VALUES(?,?)').run('a', 1).changes).toBe(1);
    expect(db.prepare('SELECT n FROM items WHERE id=?').get('a')).toEqual({ n: 1 });
    expect(db.prepare('SELECT n FROM items WHERE id=?').get('missing')).toBeUndefined();
    expect(db.prepare('SELECT * FROM items').all()).toEqual([{ id: 'a', n: 1 }]);
    expect(changes.length).toBe(2);
    expect((await open(db.snapshot())).prepare('SELECT COUNT(*) c FROM items').get()).toEqual({ c: 1 });
  });

  it('never saves a file in WAL mode, which would hang the next launch', async () => {
    const db = await open();
    db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    db.exec('CREATE TABLE items(id TEXT)');
    const reopened = await open(db.snapshot());
    expect(reopened.prepare('PRAGMA journal_mode').get()).not.toEqual({ journal_mode: 'wal' });
  });

  it('keeps foreign keys enforced after a snapshot', async () => {
    const db = await open();
    db.exec('PRAGMA foreign_keys = ON; CREATE TABLE a(id TEXT PRIMARY KEY); CREATE TABLE b(id TEXT REFERENCES a(id));');
    db.snapshot();
    expect(() => db.prepare('INSERT INTO b VALUES(?)').run('none')).toThrow();
  });
});

describe('phone router', () => {
  it('decodes params, parses the body and reports a missing route', async () => {
    const app = Fastify();
    app.post('/api/items/:id', async (request, reply) => reply.code(201).send({ id: request.params.id, body: request.body, q: request.query.q }));
    const response = await app.handle('/api/items/netease%3A1?q=x', { method: 'POST', body: '{"a":1}' });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: 'netease:1', body: { a: 1 }, q: 'x' });
    expect((await app.handle('/api/none')).status).toBe(404);
  });

  it('sends thrown errors to the error handler', async () => {
    const app = Fastify();
    app.setErrorHandler((_error, _request, reply) => reply.code(502).send({ error: { code: 'BAD' } }));
    app.get('/api/fail', async () => { throw new Error('no'); });
    expect((await app.handle('/api/fail')).status).toBe(502);
  });
});

describe('native fetch', () => {
  const fetchWith = (data: unknown, status = 200, seen: NativeRequest[] = []) => createNativeFetch(async options => {
    seen.push(options); return { status, headers: { 'Content-Type': 'text/plain', Vary: ['a', 'b'] }, data, url: 'https://cdn.example/final' };
  });

  it('keeps a Referer the browser would strip and sends JSON as an object', async () => {
    const seen: NativeRequest[] = [];
    await fetchWith('ok', 200, seen)('https://a.example/', { method: 'POST', headers: { referer: 'https://y.qq.com/', 'content-type': 'application/json' }, body: '{"a":1}' });
    expect(seen[0].headers.referer).toBe('https://y.qq.com/');
    expect(seen[0].data).toEqual({ a: 1 });
  });

  it('returns text for parsed JSON and exposes the final URL', async () => {
    const response = await fetchWith({ ok: true })('https://a.example/');
    expect(await response.text()).toBe('{"ok":true}');
    expect(response.url).toBe('https://cdn.example/final');
    expect(response.headers.get('vary')).toBe('a, b');
  });

  it('allows empty HEAD and 204 answers', async () => {
    expect((await fetchWith('', 200)('https://a.example/', { method: 'HEAD' })).body).toBeNull();
    expect((await fetchWith('', 204)('https://a.example/')).status).toBe(204);
  });

  it('stops when the caller aborts', async () => {
    const controller = new AbortController();
    const pending = createNativeFetch(() => new Promise(() => undefined))('https://a.example/', { signal: controller.signal });
    controller.abort(new Error('stop'));
    await expect(pending).rejects.toThrow('stop');
  });
});
