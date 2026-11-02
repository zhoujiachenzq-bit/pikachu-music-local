import { afterEach, expect, it, vi } from 'vitest';
import { fetchJsonWithDeadline } from './fetchDeadline.js';
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('stops waiting for an unresponsive discovery request without modern AbortSignal methods', async () => {
  vi.useFakeTimers(); vi.stubGlobal('AbortSignal', {});
  vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('timed out'))))));
  const pending = expect(fetchJsonWithDeadline('https://music.163.com/test', {}, 100)).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(100); await pending;
  expect(vi.getTimerCount()).toBe(0);
});
