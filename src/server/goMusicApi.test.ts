import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../shared/types.js';
import { goMusicApiBaseUrl, goMusicApiStreamUrl, openGoMusicApiStream, resolveExactWithGoMusicApi, resolveWithGoMusicApi, searchWithGoMusicApi } from './goMusicApi.js';
import { isAmbiguousFallback, isSafeAutomaticMatch, matchScore } from './sources.js';

const input: Track = {
  id: 'kuwo:broken', source: 'kuwo', sourceTrackId: 'broken', title: '贝加尔湖畔', artist: '李健',
  album: '', duration: 245_000, coverUrl: null, sourceUrl: null
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}
function audio(size = 5_000_000, type = 'audio/mpeg') {
  const bytes = new Uint8Array(128); bytes.set([73, 68, 51]);
  return new Response(bytes, { status: 206, headers: { 'content-type': type, 'content-range': `bytes 0-127/${size}` } });
}

describe('go-music-api backup resolver', () => {
  it('accepts only an explicit HTTP(S) service URL without credentials', () => {
    expect(goMusicApiBaseUrl('http://127.0.0.1:8080/')).toBe('http://127.0.0.1:8080');
    expect(goMusicApiBaseUrl('file:///tmp/music')).toBeNull();
    expect(goMusicApiBaseUrl('http://user:secret@127.0.0.1:8080')).toBeNull();
  });

  it('returns a validated same-origin proxy URL for a high-confidence alternate source', async () => {
    const fetcher = vi.fn(async (request: string | URL) => {
      const url = new URL(request);
      if (url.pathname.endsWith('/switch') && url.searchParams.get('target') === 'qq') {
        return json({ id: 'qq-song', source: 'qq', name: input.title, artist: input.artist, duration: 245, album: '测试专辑' });
      }
      if (url.pathname.endsWith('/inspect') && url.searchParams.get('source') === 'qq') return json({ valid: true, size: '5.6 MB' });
      if (url.pathname.endsWith('/stream') && url.searchParams.get('source') === 'qq') return audio();
      if (url.pathname.endsWith('/lyric')) return json({ code: 200, data: { lyric: '[00:01.00]测试歌词' } });
      return json({ error: 'no match' }, 404);
    });
    const result = await resolveWithGoMusicApi(input, {
      baseUrl: 'http://127.0.0.1:8080', fetcher, score: matchScore, ambiguous: isAmbiguousFallback, eligible: isSafeAutomaticMatch
    });
    expect(result).toMatchObject({ actualSource: 'qq', fallback: true, backupProvider: 'go-music-api', lyric: '[00:01.00]测试歌词' });
    expect(result?.audioUrl).toMatch(/^\/api\/backup-media\?/);
    expect(result?.audioUrl).toContain('source=qq');
  });

  it('uses an immutable platform id for a validated same-source backup', async () => {
    const exact = { ...input, id: 'migu:6001|E|SQ', source: 'migu' as const, sourceTrackId: '6001|E|SQ' };
    const fetcher = vi.fn(async (request: string | URL) => {
      const url = new URL(request);
      if (url.pathname.endsWith('/inspect')) return json({ valid: true, size: '4.1 MB' });
      if (url.pathname.endsWith('/stream')) return audio();
      if (url.pathname.endsWith('/lyric')) return json({ data: { lyric: '[00:02.00]同源歌词' } });
      return json({}, 404);
    });
    await expect(resolveExactWithGoMusicApi(exact, { baseUrl: 'http://127.0.0.1:8080', fetcher })).resolves.toMatchObject({
      id: exact.id, sourceTrackId: exact.sourceTrackId, actualSource: 'migu', backupProvider: 'go-music-api', fallback: true
    });
  });

  it('normalizes multi-source backup search metadata', async () => {
    const fetcher = vi.fn(async () => json({ data: { songs: [
      { id: 'qq-1', source: 'qq', name: '退后', artist: '周杰伦', album: '依然范特西', duration: 261, cover: 'https://example.test/cover.jpg' },
      { id: 'ignored', source: 'kuwo', name: '退后', artist: '周杰伦', duration: 261 }
    ] } }));
    const tracks = await searchWithGoMusicApi('退后 周杰伦', { baseUrl: 'http://127.0.0.1:8080', fetcher, sources: ['qq'] });
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({ source: 'qq', sourceTrackId: 'qq-1', duration: 261_000, title: '退后', artist: '周杰伦' });
    const url = new URL(fetcher.mock.calls[0][0]);
    expect(url.searchParams.getAll('sources')).toEqual(['qq']);
  });

  it('falls back to exact search results when the switch endpoint returns weak candidates', async () => {
    const fetcher = vi.fn(async (request: string | URL) => {
      const url = new URL(request);
      if (url.pathname.endsWith('/switch')) {
        const target = url.searchParams.get('target');
        return json({ id: `wrong-${target}`, source: target, name: input.title, artist: '其他歌手', duration: 280 });
      }
      if (url.pathname.endsWith('/search')) return json({ data: { songs: [
        { id: 'qq-original', source: 'qq', name: input.title, artist: input.artist, album: '原唱专辑', duration: 245 }
      ] } });
      if (url.pathname.endsWith('/inspect')) return json({ valid: true, size: '5.2 MB' });
      if (url.pathname.endsWith('/stream')) return audio();
      if (url.pathname.endsWith('/lyric')) return json({ data: { lyric: '[00:01.00]备用搜索歌词' } });
      return json({}, 404);
    });
    const result = await resolveWithGoMusicApi(input, {
      baseUrl: 'http://127.0.0.1:8080', fetcher, score: matchScore, ambiguous: isAmbiguousFallback, eligible: isSafeAutomaticMatch
    });
    expect(result).toMatchObject({ actualSource: 'qq', sourceTrackId: 'qq-original', backupProvider: 'go-music-api' });
    expect(fetcher.mock.calls.some(call => new URL(call[0]).pathname.endsWith('/search'))).toBe(true);
  });

  it('rejects a tiny Kuwo restriction prompt reported as a playable response', async () => {
    const neteaseInput = { ...input, id: 'netease:broken', source: 'netease' as const };
    const fetcher = vi.fn(async (request: string | URL) => {
      const url = new URL(request);
      if (url.pathname.endsWith('/switch') && url.searchParams.get('target') === 'kuwo') {
        return json({ id: '1116274', source: 'kuwo', name: input.title, artist: input.artist, duration: 245 });
      }
      if (url.pathname.endsWith('/inspect') && url.searchParams.get('source') === 'kuwo') return json({ valid: true, size: '0.2 MB' });
      if (url.pathname.endsWith('/stream') && url.searchParams.get('source') === 'kuwo') return audio(200000);
      return json({ error: 'no match' }, 404);
    });
    await expect(resolveWithGoMusicApi(neteaseInput, {
      baseUrl: 'http://127.0.0.1:8080', fetcher, score: matchScore, ambiguous: isAmbiguousFallback, eligible: isSafeAutomaticMatch
    })).resolves.toBeNull();
  });

  it('rejects a same-title candidate when artist and duration evidence is weak', async () => {
    const fetcher = vi.fn(async (request: string | URL) => {
      const url = new URL(request);
      if (url.pathname.endsWith('/switch') && url.searchParams.get('target') === 'qq') {
        return json({ id: 'wrong-version', source: 'qq', name: input.title, artist: '其他歌手', duration: 212 });
      }
      return json({ error: 'no match' }, 404);
    });
    await expect(resolveWithGoMusicApi(input, {
      baseUrl: 'http://127.0.0.1:8080', fetcher, score: matchScore, ambiguous: isAmbiguousFallback, eligible: isSafeAutomaticMatch
    })).resolves.toBeNull();
    expect(fetcher.mock.calls.some(call => new URL(call[0]).pathname.endsWith('/inspect'))).toBe(false);
  });

  it('forwards Range requests only to the configured backup stream endpoint', async () => {
    const url = goMusicApiStreamUrl({ source: 'qq', id: 'song-id', name: 'Song', artist: 'Artist', duration: 200 }, 'http://127.0.0.1:8080');
    expect(url?.pathname).toBe('/api/v1/music/stream');
    const fetcher = vi.fn(async () => new Response(new Uint8Array(16), { status: 206, headers: { 'content-type': 'audio/mpeg' } }));
    const response = await openGoMusicApiStream(
      { source: 'qq', id: 'song-id', name: 'Song', artist: 'Artist' }, 'bytes=10-20',
      { baseUrl: 'http://127.0.0.1:8080', fetcher }
    );
    expect(response?.status).toBe(206);
    expect(fetcher.mock.calls[0][1]?.headers).toEqual({ accept: 'application/octet-stream', range: 'bytes=10-20' });
  });

  it('retries one transient backup stream failure', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('temporary', { status: 404 }))
      .mockResolvedValueOnce(audio());
    const response = await openGoMusicApiStream(
      { source: 'netease', id: 'song-id', name: 'Song', artist: 'Artist' }, 'bytes=0-1023',
      { baseUrl: 'http://127.0.0.1:8080', fetcher }
    );
    expect(response?.status).toBe(206);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('keeps a failing provider from suppressing an unrelated healthy provider', async () => {
    const failed = async () => { throw new Error('one provider timed out'); };
    for (let i = 0; i < 2; i++) await searchWithGoMusicApi('test', { baseUrl: 'http://127.0.0.1:8080', sources: ['kugou'], fetcher: failed });
    const fetcher = vi.fn(async () => json({ data: { songs: [{ source: 'qianqian', id: '1', name: 'Song', artist: 'Artist' }] } }));
    expect(await searchWithGoMusicApi('test', { baseUrl: 'http://127.0.0.1:8080', sources: ['qianqian'], fetcher })).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([['application/json', '{"code":"error"}'], ['audio/mpeg', '<html>blocked</html>']])('rejects a bogus %s stream even when inspect would say valid', async (type, body) => {
    const fetcher = vi.fn(async (request: string | URL) => new URL(request).pathname.endsWith('/inspect') ? json({ valid: true, size: '5 MB' }) : new Response(body, { headers: { 'content-type': type } }));
    expect(await resolveExactWithGoMusicApi(input, { baseUrl: 'http://127.0.0.1:8080', fetcher })).toBeNull();
    expect(fetcher.mock.calls.some(call => new URL(call[0]).pathname.endsWith('/lyric'))).toBe(false);
  });

  it('uses audio bytes to repair a wrong HTML MIME and preserves all sampled bytes', async () => {
    const response = await openGoMusicApiStream({ source: 'jamendo', id: '1', name: 'Song', artist: 'Artist' }, 'bytes=0-4095', { baseUrl: 'http://127.0.0.1:8080', fetcher: async () => audio(5_000_000, 'text/html') });
    expect(response?.headers.get('content-type')).toBe('audio/mpeg');
    const bytes = new Uint8Array(await response!.arrayBuffer());
    expect(bytes.length).toBe(128); expect([...bytes.slice(0, 3)]).toEqual([73, 68, 51]);
  });

  it('keeps a corrected MIME for later seeks without sharing it with another song', async () => {
    const query = { source: 'jamendo' as const, id: 'seek-test', name: 'Song', artist: 'Artist' };
    const options = { baseUrl: 'http://127.0.0.1:8080', fetcher: async () => audio(5000000, 'text/html') };
    const first = await openGoMusicApiStream(query, 'bytes=0-4095', options); await first?.body?.cancel();
    const seek = await openGoMusicApiStream(query, 'bytes=4096-', { ...options, fetcher: async () => new Response(new Uint8Array(64), { status: 206, headers: { 'content-type': 'text/html' } }) });
    expect(seek?.headers.get('content-type')).toBe('audio/mpeg'); await seek?.body?.cancel();
    const other = await openGoMusicApiStream({ ...query, id: 'another-song' }, 'bytes=4096-', { ...options, fetcher: async () => new Response(new Uint8Array(64), { status: 206, headers: { 'content-type': 'text/html' } }) });
    expect(other?.status).toBe(502);
  });
});
