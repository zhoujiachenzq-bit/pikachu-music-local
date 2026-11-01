import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseGoMusicSearch, searchGoMusicNative } from './goMusicSearch.js';

afterEach(() => vi.unstubAllGlobals());

describe('upstream QQ and Migu search protocols on Android networking', () => {
  it('keeps QQ search metadata for paid and free tracks without claiming playability', () => {
    const song = { songmid: 'real-mid', songname: '晴天', interval: 269, singer: [{ name: '周杰伦' }], albumname: '叶惠美', albummid: 'album' };
    expect(parseGoMusicSearch('qq', { code: 0, data: { song: { list: [song, { ...song, songmid: 'paid', pay: { payplay: 1 } }] } } }, '晴天', 10))
      .toMatchObject([
        { id: 'qq:real-mid', title: '晴天', artist: '周杰伦', duration: 269000 },
        { id: 'qq:paid', title: '晴天', artist: '周杰伦', duration: 269000 }
      ]);
  });
  it('keeps the Migu content/resource/format tuple and does not invent duration', () => {
    const data = { code: '000000', songResultData: { result: [{ contentId: '123', copyrightId: 'different', name: '晴天', artists: [{ name: '歌手' }],
      newRateFormats: [{ resourceType: 'E', formatType: 'SQ' }, { resourceType: '2', formatType: 'PQ' }] }] } };
    expect(parseGoMusicSearch('migu', data, '晴天', 10)).toMatchObject([{ id: 'migu:123|2|PQ', sourceTrackId: '123|2|PQ', duration: 0 }]);
  });
  it('sends upstream Migu parameters, native headers and cancellation', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ code: '000000', songResultData: { result: [] } })));
    vi.stubGlobal('fetch', fetcher); const controller = new AbortController();
    await searchGoMusicNative('migu', '中文 & test', 10, controller.signal);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    const parsed = new URL(url);
    expect(parsed.searchParams.get('text')).toBe('中文 & test');
    expect(JSON.parse(parsed.searchParams.get('searchSwitch')!)).toMatchObject({ song: 1, mvSong: 0 });
    expect(init.signal).toBe(controller.signal);
    expect(init.headers).toMatchObject({ referer: 'http://music.migu.cn/' });
  });
  it('reports an API rejection rather than treating it as an empty catalogue', () => {
    expect(() => parseGoMusicSearch('qq', { code: 2000 }, '歌', 10)).toThrow('被拒绝');
  });
});
