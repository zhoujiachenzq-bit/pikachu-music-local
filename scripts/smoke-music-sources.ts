// No .env or user database is loaded. Run with --native for QQ/Migu protocol
// smoke tests; with a local service URL to exercise all upstream searches.
import { searchGoMusicNative } from '../src/server/goMusicSearch.js';
import { searchWithGoMusicApi } from '../src/server/goMusicApi.js';
import { SEARCH_SOURCES, SOURCE_NAMES } from '../src/shared/types.js';

const native = process.argv.includes('--native');
const baseUrl = process.argv.find(value => /^https?:\/\//.test(value));
if (!native && !baseUrl) throw new Error('用法：pnpm exec tsx scripts/smoke-music-sources.ts --native 或 http://127.0.0.1:8080');
const sources = native ? ['qq', 'migu'] as const : SEARCH_SOURCES;
for (const source of sources) {
  const began = Date.now();
  try {
    const tracks = native ? await searchGoMusicNative(source as 'qq' | 'migu', '晴天', 10, AbortSignal.timeout(12000))
      : await searchWithGoMusicApi('晴天', { baseUrl, sources: [source], limit: 10 });
    console.log(JSON.stringify({ source, label: SOURCE_NAMES[source], count: tracks.length, elapsedMs: Date.now() - began,
      candidates: tracks.slice(0, 2).map(track => ({ id: track.sourceTrackId, title: track.title, artist: track.artist, duration: track.duration })) }));
    if (!tracks.length) process.exitCode = 1;
  } catch (error) { console.log(JSON.stringify({ source, elapsedMs: Date.now() - began, error: String(error) })); process.exitCode = 1; }
}
