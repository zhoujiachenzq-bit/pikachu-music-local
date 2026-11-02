import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

describe('PWA assets', () => {
  it('declares installable icons that exist in the public directory', () => {
    const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8')) as { icons: Array<{ src: string; sizes: string }> };
    expect(manifest.icons.map(icon => icon.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    for (const icon of manifest.icons) expect(existsSync(`public${icon.src}`)).toBe(true);
  });

  it('keeps APIs, cross-origin media and audio requests out of the service-worker cache', () => {
    const worker = readFileSync('public/sw.js', 'utf8');
    expect(worker).toContain("url.origin !== self.location.origin");
    expect(worker).toContain("url.pathname.startsWith('/api/')");
    expect(worker).toContain("request.destination === 'audio'");
  });

  it('discovers the hashed production assets while installing the page shell', () => {
    const worker = readFileSync('public/sw.js', 'utf8');
    expect(worker).toContain("fetch('/', { cache: 'no-cache' })");
    expect(worker).toContain("url.pathname.startsWith('/assets/')");
    expect(worker).toContain("'/pikachu.gif'");
    expect(worker).toContain('pikachu-music-shell-v0.7.1-r1');
    // A theme image can render online yet fail after installation without its cache entry.
    expect(worker).toContain("'/moon-gate-garden.webp'");
    expect(existsSync('public/moon-gate-garden.webp')).toBe(true);
  });

  it('installs the new garden background and serves it when offline', async () => {
    const origin = 'https://fixture.invalid';
    const entries = new Map<string, Response>();
    const listeners: Record<string, (event: any) => void> = {};
    const key = (value: string | { url: string }) => new URL(typeof value === 'string' ? value : value.url, origin).pathname;
    let offline = false;
    const fetcher = async (input: string | { url: string }) => {
      if (offline) throw new Error('offline fixture');
      const path = key(input);
      return new Response(path === '/' ? '<script src="/assets/app-fixture.js"></script>' : path, {
        headers: { 'content-type': path === '/' ? 'text/html' : path.endsWith('.webp') ? 'image/webp' : 'text/javascript' },
      });
    };
    const cache = {
      addAll: async (paths: string[]) => { for (const path of paths) entries.set(path, await fetcher(path)); },
      put: async (path: string, response: Response) => { entries.set(key(path), response); },
    };
    runInNewContext(readFileSync('public/sw.js', 'utf8'), {
      URL, fetch: fetcher,
      caches: { open: async () => cache, match: async (request: { url: string }) => entries.get(key(request))?.clone() },
      self: { location: { origin }, addEventListener: (name: string, listener: (event: any) => void) => { listeners[name] = listener; } },
    });
    let installation!: Promise<void>;
    listeners.install!({ waitUntil: (pending: Promise<void>) => { installation = pending; } });
    await installation;
    expect(entries.has('/assets/app-fixture.js')).toBe(true);
    offline = true;
    let response!: Promise<Response>;
    for (const path of ['/moon-gate-garden.webp', '/coast-sea.webp', '/coast-sea-fish-far.webp', '/coast-sea-fish-near.webp', '/coast-sea-weed-left.webp', '/coast-sea-weed-right.webp', '/holiday-coast.webp', '/holiday-coast-mask.webp', '/holiday-coast-bird.webp', '/lofi-gate.webp', '/lofi-gate-mask.webp']) {
      expect(existsSync(`public${path}`)).toBe(true);
      listeners.fetch!({
        request: { method: 'GET', url: `${origin}${path}`, mode: 'cors', destination: 'image' },
        respondWith: (pending: Promise<Response>) => { response = pending; },
      });
      expect(await (await response).text()).toBe(path);
    }
  });
});
