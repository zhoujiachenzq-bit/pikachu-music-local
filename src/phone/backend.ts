import { CapacitorHttp } from '@capacitor/core';
import { localMusicApiAvailable, markLocalMusicApiReady } from '../client/phone';
import { createNativeFetch } from './nativeFetch';
import type { PhoneApp } from './shims/fastify';
import type { NativeResponse } from './nativeFetch';
import { localServiceConnector } from './localService';
import { ImportEvents } from './importEvents';

const LOCAL_USER_CREATED_AT = '2000-01-01T00:00:00.000Z';
const LOCAL_MUSIC_API = 'http://127.0.0.1:8080';

function installAbortSignalAny() {
  const signalType = AbortSignal as { any?: typeof AbortSignal.any };
  if (!AbortSignal.timeout) AbortSignal.timeout = milliseconds => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('请求超时', 'TimeoutError')), milliseconds);
    return controller.signal;
  };
  if (!AbortSignal.prototype.throwIfAborted) AbortSignal.prototype.throwIfAborted = function () {
    if (this.aborted) throw this.reason || new DOMException('请求已取消', 'AbortError');
  };
  if (signalType.any) return;
  signalType.any = signals => {
    const controller = new AbortController();
    for (const signal of signals) {
      if (signal.aborted) { controller.abort(signal.reason); break; }
      signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
    }
    return controller.signal;
  };
}

const nativeFetch = createNativeFetch(options => CapacitorHttp.request(options) as Promise<NativeResponse>);

// The bundled service takes a moment to listen after the app starts.
function installFetch(app: PhoneApp, connect: () => Promise<void>) {
  const webFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('/api/')) {
      if (/^\/api\/(platform|search)(\/|\?|$)/.test(url) || /^\/api\/(imports|playlists\/[^/]+\/sync|tracks\/[^/]+\/(resolve|download|lyrics))(\?|$)/.test(url)) await connect();
      return app.handle(url, init);
    }
    if (/^https?:/.test(url) && !url.startsWith(location.origin)) return nativeFetch(url, init);
    return webFetch(input, init);
  };
}

export async function startPhoneBackend() {
  const env: Record<string, string> = { RECOMMENDATION_SKIP_PREFLIGHT: '1' };
  Object.assign(globalThis, { process: { env } });
  installAbortSignalAny();
  const available = await localMusicApiAvailable();
  const connect = localServiceConnector(env, async () => available && (await nativeFetch(`${LOCAL_MUSIC_API}/swagger/index.html`)).ok, markLocalMusicApiReady);
  if (available) await connect();
  const { openPhoneDatabase } = await import('./shims/sqlite');
  await openPhoneDatabase();
  const [{ createDatabase }, { createApp }, { createSession, createUserId }] = await Promise.all([
    import('../server/db'), import('../server/app'), import('../server/auth')
  ]);
  const db = createDatabase(':memory:');
  let user = db.prepare('SELECT id FROM users LIMIT 1').get() as { id: string } | undefined;
  if (!user) {
    user = { id: createUserId() };
    db.prepare(`INSERT INTO users(id,username,password_hash,password_salt,created_at,updated_at) VALUES(?,'我','','',?,?)`).run(user.id, LOCAL_USER_CREATED_AT, LOCAL_USER_CREATED_AT);
  }
  db.prepare('DELETE FROM sessions').run();
  const app = await createApp({ db, logger: false, trustProxy: false, mediaTickets: { issue: () => null } as never }) as unknown as PhoneApp;
  app.cookies = { pikachu_session: createSession(db, user.id) };
  Object.assign(window, { EventSource: ImportEvents });
  installFetch(app, available ? connect : async () => undefined);
}
