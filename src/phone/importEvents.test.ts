import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImportEvents } from './importEvents';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('phone import progress', () => {
  it('reports the terminal result once and stops polling', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => Response.json({ job: { status: 'completed', processed: 3 } }));
    vi.stubGlobal('fetch', fetcher);
    const stream = new ImportEvents('/api/imports/job/events'); const message = vi.fn(); stream.onmessage = message;
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/imports/job');
    expect(JSON.parse(message.mock.calls[0][0].data)).toMatchObject({ processed: 3, status: 'completed' });
  });
  it('reports failed status requests and never emits an undefined job', async () => {
    vi.useFakeTimers(); vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'failed' }, { status: 503 })));
    const stream = new ImportEvents('/api/imports/job/events'); stream.onmessage = vi.fn(); stream.onerror = vi.fn();
    await vi.advanceTimersByTimeAsync(1000);
    expect(stream.onerror).toHaveBeenCalledOnce(); expect(stream.onmessage).not.toHaveBeenCalled();
  });
  it('ignores late results after the dialog stops watching', async () => {
    vi.useFakeTimers(); let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
    const stream = new ImportEvents('/api/imports/job/events'); stream.onmessage = vi.fn();
    await vi.advanceTimersByTimeAsync(1); stream.close(); finish(Response.json({ job: { status: 'completed' } }));
    await vi.advanceTimersByTimeAsync(1000); expect(stream.onmessage).not.toHaveBeenCalled();
  });
});
