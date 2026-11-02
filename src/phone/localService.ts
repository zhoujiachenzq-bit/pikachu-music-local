// Retry after a slow cold start instead of permanently disabling discovery.
export function localServiceConnector(env: Record<string, string>, probe: () => Promise<boolean>, ready: () => void) {
  let pending: Promise<void> | undefined;
  return () => {
    if (env.GO_MUSIC_API_URL) return Promise.resolve();
    return pending ??= (async () => {
      const deadline = Date.now() + 4000;
      do {
        if (await probe().catch(() => false)) {
          env.GO_MUSIC_API_URL = 'http://127.0.0.1:8080';
          env.GO_MUSIC_API_DIRECT_MEDIA = '1'; ready(); return;
        }
        await new Promise(resolve => setTimeout(resolve, 150));
      } while (Date.now() < deadline);
    })().finally(() => { pending = undefined; });
  };
}
