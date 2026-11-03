import { spawn } from 'node:child_process';
import { mkdtempSync, existsSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
const resources = resolve(process.argv[2] || resolve(import.meta.dirname, '../data/windows/output/win-unpacked/resources'));
const working = mkdtempSync(join(tmpdir(), 'music-house-desktop-'));
// Test the packaged files outside the checkout: missing modules must not fall
// back to the developer's ancestor node_modules and produce a false pass.
cpSync(resolve(resources, 'runtime'), resolve(working, 'runtime'), { recursive: true, dereference: true });
assert.ok(existsSync(resolve(working, 'runtime/node_modules/fastify/package.json')), 'Packaged backend dependency fastify is missing');
let child;
async function boot() {
child = spawn(resolve(resources, 'node.exe'), [resolve(working, 'runtime/server.mjs')], {
  cwd: working, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, NODE_ENV: 'development', PIKACHU_DB_PATH: join(working, 'music.sqlite') }
});
let errors = '';
child.stderr.on('data', chunk => { errors += chunk; });
  return await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error('Runtime timeout: ' + errors)), 20000);
    let output = '';
    child.once('error', reject);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Runtime exit ${code}: ${errors}`)); });
    child.stdout.on('data', chunk => {
      output += chunk;
      for (const line of output.split('\n').filter(Boolean)) {
        try { const data = JSON.parse(line); if (data.ready) { clearTimeout(timer); resolveReady(`http://127.0.0.1:${data.port}`); } } catch {}
      }
    });
  });
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  const current = child;
  await new Promise(resolveExit => {
    const timer = setTimeout(() => current.kill(), 3000);
    current.once('exit', () => { clearTimeout(timer); resolveExit(); });
    if (current.connected) current.send('shutdown'); else current.kill();
  });
}
try {
  let origin = await boot();
  const health = await fetch(`${origin}/api/health`).then(response => response.json());
  assert.equal(health.ok, true);
  const page = await fetch(origin).then(response => response.text());
  assert.ok(page.includes('/assets/index-'));
  assert.ok(existsSync(join(working, 'music.sqlite')));
  const credentials = { username: 'desktop-fixture', password: 'Fixture-only-2026' };
  const register = await fetch(`${origin}/api/auth/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials) });
  assert.equal(register.status, 201);
  const cookie = register.headers.get('set-cookie').split(';')[0];
  const created = await fetch(`${origin}/api/playlists`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Restart persistence fixture' }) });
  assert.equal(created.status, 201);
  const id = (await created.json()).playlist.id;
  await stop();
  origin = await boot();
  const login = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials) });
  assert.equal(login.status, 200);
  const restored = await fetch(`${origin}/api/playlists`, { headers: { cookie: login.headers.get('set-cookie').split(';')[0] } }).then(response => response.json());
  assert.equal(restored.playlists.length, 1);
  assert.equal(restored.playlists[0].id, id);
  console.log('Bundled runtime health, web assets, account/playlist writes, restart and persisted data passed.');
} finally {
  await stop();
}
