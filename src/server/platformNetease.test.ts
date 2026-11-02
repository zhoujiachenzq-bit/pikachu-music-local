import { afterEach, describe, expect, it, vi } from 'vitest';
import { platformQuerySchema, queryPlatform } from './platformGateway.js';
import { createApp } from './app.js';
import { createDatabase } from './db.js';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('discovery independent of the bundled service', () => {
  it('loads public recommendations when the desktop service is offline', async () => {
    vi.stubEnv('GO_MUSIC_API_URL', 'http://127.0.0.1:8080');
    const fetcher = vi.fn(async (input: string) => {
      if (input.startsWith('http://127.0.0.1')) throw new Error('ECONNREFUSED');
      return Response.json({ code:200, result:[{id:123,name:'真实目录',picUrl:'http://p1.music.126.net/cover.jpg',trackCount:20}] });
    });
    vi.stubGlobal('fetch', fetcher);
    expect(await queryPlatform(platformQuerySchema.parse({ mode:'recommend',source:'netease' }))).toMatchObject({items:[{id:'123',name:'真实目录',count:20,cover:'https://p1.music.126.net/cover.jpg'}]});
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toContain('https://music.163.com/');
  });
  it('prefers the native catalogue on phones, without needing AbortSignal.timeout', async () => {
    vi.stubEnv('GO_MUSIC_API_DIRECT_MEDIA', '1'); vi.stubEnv('GO_MUSIC_API_URL','');
    vi.stubGlobal('AbortSignal', {});
    const fetcher = vi.fn(async () => Response.json({code:200,result:{albums:[{id:456,name:'专辑',size:3,picUrl:'https://p1.music.126.net/a.jpg'}]}}));
    vi.stubGlobal('fetch', fetcher);
    expect(await queryPlatform(platformQuerySchema.parse({mode:'search',source:'netease',type:'album',q:'歌手'}))).toMatchObject({items:[{id:'456',kind:'album',count:3}]});
    expect(fetcher.mock.calls).toHaveLength(1);
  });
  it('opens a real playlist through its complete track directory with no Go service', async () => {
    vi.stubEnv('GO_MUSIC_API_URL','');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({playlist:{id:12345,trackCount:1,trackIds:[{id:111}],tracks:[{id:111,name:'真实歌曲',ar:[{name:'原歌手'}],al:{name:'专辑'},dt:200000}]}})));
    expect(await queryPlatform(platformQuerySchema.parse({mode:'detail',source:'netease',type:'playlist',id:'12345'}))).toMatchObject({tracks:[{id:'netease:111',title:'真实歌曲',artist:'原歌手',duration:200000}]});
  });
  it('completes recommendation → detail → local save without an available bundled service', async () => {
    vi.stubEnv('GO_MUSIC_API_URL','');
    vi.stubGlobal('fetch', vi.fn(async (input: string) => Response.json(input.includes('personalized')
      ? {code:200,result:[{id:12345,name:'公开歌单',trackCount:1}]}
      : {playlist:{id:12345,trackCount:1,trackIds:[{id:111}],tracks:[{id:111,name:'真实歌曲',ar:[{name:'原歌手'}],al:{name:'专辑'},dt:200000}]}})));
    const db = createDatabase(':memory:'); const app = await createApp({db,logger:false});
    try {
      const auth = await app.inject({method:'POST',url:'/api/auth/register',payload:{username:'DiscoveryFallbackQA',password:'Fixture-only-2026'}});
      const headers = {cookie:auth.headers['set-cookie']!.split(';')[0]};
      expect((await app.inject({url:'/api/platform/browse?mode=recommend&source=netease',headers})).json().items[0].id).toBe('12345');
      const detail = (await app.inject({url:'/api/platform/browse?mode=detail&source=netease&id=12345',headers})).json();
      const saved = await app.inject({method:'POST',url:'/api/platform/save',headers,payload:{previewId:detail.previewId,name:'本地歌单'}});
      expect(saved.statusCode).toBe(200); expect(saved.json().playlist.tracks).toHaveLength(1);
    } finally { await app.close(); db.close(); }
  });
});
