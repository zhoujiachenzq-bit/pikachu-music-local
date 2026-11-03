const { app, BrowserWindow, dialog, shell } = require('electron');
const { spawn } = require('node:child_process');
const { mkdirSync } = require('node:fs');
const path = require('node:path');

app.setName('MusicHouse');
let window, backend, musicApi, closing = false;
const safeEnv = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(SystemRoot|SystemDrive|WINDIR|PATH|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|COMSPEC)$/i.test(key)));

async function musicReady() {
  try { const response = await fetch('http://127.0.0.1:8080/swagger/index.html', { signal: AbortSignal.timeout(600) }); return response.ok; }
  catch { return false; }
}

async function start() {
  const resources = process.resourcesPath;
  const storage = app.getPath('userData');
  mkdirSync(storage, { recursive: true });
  const musicHome = path.join(storage, 'music-service');
  mkdirSync(musicHome, { recursive: true });
  if (!await musicReady()) {
    musicApi = spawn(path.join(resources, 'music-api.exe'), [], { cwd: musicHome, env: safeEnv(), windowsHide: true, stdio: 'ignore' });
    musicApi.on('error', () => { musicApi = undefined; });
    for (let i = 0; i < 30 && !await musicReady(); i++) await new Promise(resolve => setTimeout(resolve, 200));
  }
  const ready = await musicReady();
  const origin = await new Promise((resolve, reject) => {
    backend = spawn(path.join(resources, 'node.exe'), [path.join(resources, 'runtime/server.mjs')], {
      cwd: storage, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...safeEnv(), NODE_ENV: 'development', HOST: '127.0.0.1', PIKACHU_DB_PATH: path.join(storage, 'data/music.sqlite'), ...(ready ? { GO_MUSIC_API_URL: 'http://127.0.0.1:8080' } : {}) }
    });
    let output = '';
    const timer = setTimeout(() => reject(new Error('本地服务启动超时')), 20000);
    backend.once('error', error => { clearTimeout(timer); reject(error); });
    backend.once('exit', code => { clearTimeout(timer); reject(new Error(`本地服务退出（${code}）`)); if (!closing && window) { dialog.showErrorBox('音乐服务已停止', '请关闭并重新打开音乐小屋。'); app.quit(); } });
    backend.stdout.on('data', chunk => {
      output += chunk.toString();
      const lines = output.split('\n'); output = lines.pop();
      for (const line of lines) {
        try { const value = JSON.parse(line); if (value.ready && Number.isInteger(value.port) && value.port > 0 && value.port <= 65535) { clearTimeout(timer); resolve(`http://127.0.0.1:${value.port}`); } } catch { /* Ignore non-protocol output. */ }
      }
    });
    backend.stderr.on('data', () => {});
  });
  window = new BrowserWindow({ width: 1380, height: 960, minWidth: 900, minHeight: 640, show: false, backgroundColor: '#f0e4c8', icon: path.join(resources, 'pikachu.ico'), webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
  window.removeMenu();
  const local = url => { try { return new URL(url).origin === origin; } catch { return false; } };
  const external = url => { try { if (['https:', 'http:'].includes(new URL(url).protocol)) void shell.openExternal(url); } catch {} };
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (local(url)) window.webContents.downloadURL(url);
    else external(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => { if (!local(url)) { event.preventDefault(); external(url); } });
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.once('ready-to-show', () => window.show());
  await window.loadURL(origin);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(start).catch(error => { dialog.showErrorBox('音乐小屋启动失败', error.message); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => {
    if (closing) return;
    closing = true; event.preventDefault();
    const finish = () => { musicApi?.kill(); app.quit(); };
    if (backend?.connected) { backend.once('exit', finish); backend.send('shutdown'); setTimeout(() => { backend?.kill(); finish(); }, 3000).unref(); }
    else finish();
  });
}
