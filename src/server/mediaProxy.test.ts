import { describe, expect, it, vi } from 'vitest';
import type { ResolvedTrack } from '../shared/types.js';
import { MediaTicketStore, openMediaTicket, safeRangeHeader } from './mediaProxy.js';

const track: ResolvedTrack = {
  id: 'qq:1', source: 'qq', sourceTrackId: '1', title: 'Song', artist: 'Artist', album: '', duration: 180_000,
  coverUrl: null, sourceUrl: null, audioUrl: 'https://isure6.stream.qqmusic.qq.com/C600song.m4a?key=x', lyric: null, actualSource: 'qq', fallback: false
};

describe('same-origin compatibility media tickets', () => {
  it('issues scoped expiring tickets only for known source media hosts', () => {
    let now = 1000; const store = new MediaTicketStore(() => now, 5000);
    const path = store.issue('u1', track); expect(path).toMatch(/^\/api\/media\/[A-Za-z0-9_-]{32}$/);
    const token = path!.split('/').pop()!;
    expect(store.get(token, 'u2')).toBeNull(); expect(store.get(token, 'u1')).toMatchObject({ source: 'qq', userId: 'u1' });
    now += 5001; expect(store.get(token, 'u1')).toBeNull();
    expect(store.issue('u1', { ...track, audioUrl: 'https://127.0.0.1/private.m4a' })).toBeNull();
  });

  it('reuses the existing protected backup stream without another ticket', () => {
    const store = new MediaTicketStore();
    expect(store.issue('u', { ...track, audioUrl: '/api/backup-media?source=qq&id=1&name=Song&artist=Artist', backupProvider: 'go-music-api' }))
      .toContain('/api/backup-media?');
  });

  it('forwards one safe Range request and rejects non-audio responses', async () => {
    const ticket = { token: 'x'.repeat(32), userId: 'u', source: 'qq' as const, url: track.audioUrl, expiresAt: Date.now() + 1000 };
    const fetcher = vi.fn(async () => new Response('audio', { status: 206, headers: { 'content-type': 'audio/mp4', 'content-range': 'bytes 0-9/100' } }));
    await expect(openMediaTicket(ticket, 'bytes=0-9', fetcher)).resolves.toMatchObject({ status: 206 });
    expect(fetcher.mock.calls[0][1]?.headers).toMatchObject({ range: 'bytes=0-9', referer: 'https://y.qq.com/' });
    await expect(openMediaTicket(ticket, undefined, async () => new Response('<html/>', { headers: { 'content-type': 'text/html' } }))).rejects.toThrow('Invalid media response');
    expect(safeRangeHeader('bytes=0-99')).toBe('bytes=0-99'); expect(safeRangeHeader('bytes=0-1,5-8')).toBeUndefined();
  });

  it('revalidates every media redirect before the server follows it', async () => {
    const ticket = { token: 'x'.repeat(32), userId: 'u', source: 'qq' as const, url: track.audioUrl, expiresAt: Date.now() + 1000 };
    const allowed = vi.fn(async (input: string | URL) => String(input).includes('redirect')
      ? new Response('audio', { status: 200, headers: { 'content-type': 'audio/mp4' } })
      : new Response(null, { status: 302, headers: { location: 'https://dl.stream.qqmusic.qq.com/redirect.m4a' } }));
    await expect(openMediaTicket(ticket, undefined, allowed)).resolves.toMatchObject({ status: 200 });
    expect(allowed).toHaveBeenCalledTimes(2);
    expect(allowed.mock.calls[0][1]?.redirect).toBe('manual');

    const internalRedirect = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://127.0.0.1:3000/api/health' } }));
    await expect(openMediaTicket(ticket, undefined, internalRedirect)).rejects.toThrow('Unsafe media redirect');
    expect(internalRedirect).toHaveBeenCalledTimes(1);
  });
});
