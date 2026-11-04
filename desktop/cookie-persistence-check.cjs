// Developer-only integration check. It uses only the disposable fixture account.
const { app, session } = require('electron');
const assert = require('node:assert/strict');
const [mode, profile, origin] = process.argv.slice(2);
app.setPath('userData', profile);
app.whenReady().then(async () => {
  const ses = session.defaultSession;
  if (mode === 'login') {
    const response = await ses.fetch(`${origin}/api/auth/login`, { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'desktop-fixture', password: 'Fixture-only-2026' }) });
    assert.equal(response.status, 200);
  }
  if (mode === 'logout') {
    const response = await ses.fetch(`${origin}/api/auth/logout`, { method: 'POST', credentials: 'include' });
    assert.equal(response.status, 200);
  }
  const cookies = await ses.cookies.get({ url: origin, name: 'pikachu_session' });
  if (mode === 'logged-out') assert.equal(cookies.length, 0);
  else if (mode !== 'logout') {
    assert.equal(cookies.length, 1);
    assert.ok(cookies[0].expirationDate > Date.now() / 1000 + 86400);
    const result = await ses.fetch(`${origin}/api/auth/me`, { credentials: 'include' }).then(r => r.json());
    assert.equal(result.user?.username, 'desktop-fixture');
  }
  await ses.cookies.flushStore(); ses.flushStorageData();
  console.log(`Persistent login ${mode} passed.`);
  app.quit();
}).catch(error => { console.error(error.message); app.exit(1); });
