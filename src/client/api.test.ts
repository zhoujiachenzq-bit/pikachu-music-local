import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, json } from './api';

describe('API connection errors', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('turns a network failure into a clear service-unavailable error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    await expect(api('/api/health')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 } satisfies Partial<ApiError>);
    await expect(api('/api/health')).rejects.toThrow('无法连接音乐服务');
  });

  it('marks JSON bodies even when a caller uses fetch directly', () => {
    expect(json('POST', { voice: 'kokoro-zf-001' })).toMatchObject({
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"voice":"kokoro-zf-001"}'
    });
  });
});
