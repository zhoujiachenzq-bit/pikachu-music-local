import { CapacitorHttp } from '@capacitor/core';
import { createNativeFetch } from './nativeFetch';
import type { PhoneApp } from './shims/fastify';
import type { NativeResponse } from './nativeFetch';

// One person on one phone: the server's abuse limits would only get in the way.
const UNLIMITED = ['RATE_SEARCH_USER_MINUTE', 'RATE_SEARCH_IP_MINUTE', 'RATE_RESOLVE_USER_MINUTE', 'RATE_RESOLVE_IP_MINUTE', 'RATE_IMPORT_USER_DAILY', 'RATE_IMPORT_IP_DAILY', 'RATE_LISTENING_USER_MINUTE'];
const LOCAL_USER_CREATED_AT = '2000-01-01T00:00:00.000Z';

function installAbortSignalAny() {
  const signalType = AbortSignal as { any?: typeof AbortSignal.any };
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

// Stands in for the server-sent events route, which needs a streaming response.
class ImportEvents {
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  private timer: number;

  constructor(url: string) {
    const jobUrl = url.replace(/\/events$/, '');
    this.timer = window.setInterval(async () => {
      try { const { job } = await (await fetch(jobUrl)).json(); this.onmessage?.({ data: JSON.stringify(job) }); }
      catch { this.close(); this.onerror?.(); }
    }, 500);
  }

  close() { window.clearInterval(this.timer); }
}

function installFetch(app: PhoneApp) {
  const nativeFetch = createNativeFetch(options => CapacitorHttp.request(options) as Promise<NativeResponse>);
  const webFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('/api/')) return app.handle(url, init);
    if (/^https?:/.test(url) && !url.startsWith(location.origin)) return nativeFetch(url, init);
    return webFetch(input, init);
  };
}

export async function startPhoneBackend() {
  const env: Record<string, string> = { ...Object.fromEntries(UNLIMITED.map(name => [name, '1000000'])), RECOMMENDATION_SKIP_PREFLIGHT: '1' };
  Object.assign(globalThis, { process: { env } });
  installAbortSignalAny();
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
  installFetch(app);
}
