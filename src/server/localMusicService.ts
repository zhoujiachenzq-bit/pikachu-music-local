import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawn } from 'node:child_process';

// The packaged Windows helper is optional. Its absence must not block music.
export async function startLocalMusicService() {
  if (process.platform !== 'win32') return;
  const base = 'http://127.0.0.1:8080';
  if (process.env.GO_MUSIC_API_URL && process.env.GO_MUSIC_API_URL.replace(/\/$/, '') !== base) return;
  const executable = resolve('data/tools/go-music-api/go-music-api-loopback.exe');
  if (!existsSync(executable)) return;
  const ready = async () => {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 700);
    try { return (await fetch(`${base}/swagger/index.html`, { signal:controller.signal })).ok; }
    catch { return false; } finally { clearTimeout(timer); }
  };
  try {
    if (!await ready()) {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(executable, [], { cwd:dirname(executable), detached:true, windowsHide:true, stdio:'ignore' });
        child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); });
      });
      for (let i = 0; i < 12 && !await ready(); i++) await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (await ready()) process.env.GO_MUSIC_API_URL = base;
    else console.warn('内置音源服务未就绪；音乐服务继续启动。');
  } catch { console.warn('内置音源服务启动失败；音乐服务继续启动。'); }
}
