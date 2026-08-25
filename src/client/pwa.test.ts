import { existsSync, readFileSync } from 'node:fs';
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
    expect(worker).toContain('pikachu-music-shell-v0.4.0-beta.5-r1');
  });
});
