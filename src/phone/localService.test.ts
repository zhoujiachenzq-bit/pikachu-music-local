import { afterEach, describe, expect, it, vi } from 'vitest';
import { localServiceConnector } from './localService';

afterEach(() => vi.useRealTimers());
describe('local service connection', () => {
  it('retries after cold-start timeout and shares concurrent attempts', async () => {
    vi.useFakeTimers();
    const env: Record<string, string> = {};
    const probe = vi.fn(async () => false); const ready = vi.fn();
    const connect = localServiceConnector(env, probe, ready);
    const first = connect(); expect(connect()).toBe(first);
    await vi.advanceTimersByTimeAsync(4200); await first;
    expect(env.GO_MUSIC_API_URL).toBeUndefined();
    probe.mockResolvedValue(true); await connect();
    expect(env.GO_MUSIC_API_DIRECT_MEDIA).toBe('1'); expect(ready).toHaveBeenCalledOnce();
    const calls = probe.mock.calls.length; await connect(); expect(probe).toHaveBeenCalledTimes(calls);
  });
});
