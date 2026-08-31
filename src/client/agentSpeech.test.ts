import { describe, expect, it, vi } from 'vitest';
import { AgentSpeechPlayback, type SpeechState } from './agentSpeech';
import { shouldSubmitAgentInput } from './agentInput';

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function fixture(fetcher?: typeof fetch) {
  const states: SpeechState[] = [];
  const audios: Array<{ play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; onended: (() => void) | null; onerror: (() => void) | null }> = [];
  const system = { speak: vi.fn(), cancel: vi.fn() };
  const revoke = vi.fn(); const notice = vi.fn();
  const playback = new AgentSpeechPlayback({ onState: state => states.push(state), onNotice: notice }, {
    ...(fetcher ? { fetcher } : {}), createUrl: () => `blob:fixture-${audios.length}`, revokeUrl: revoke,
    createAudio: () => { const audio = { play: vi.fn().mockResolvedValue(undefined), pause: vi.fn(), load: vi.fn(), removeAttribute: vi.fn(), onended: null, onerror: null }; audios.push(audio); return audio as unknown as HTMLAudioElement; },
    systemSpeech: system as unknown as SpeechSynthesis, createUtterance: text => ({ text, onend: null, onerror: null } as unknown as SpeechSynthesisUtterance)
  });
  return { playback, states, audios, system, revoke, notice };
}
const input = (messageId: string) => ({ messageId, text: '你好', voiceId: 'gpt-sovits-zhenqi', persona: 'warm' as const, lang: 'zh' as const });
const response = () => new Response(new Uint8Array([1, 2]), { headers: { 'content-type': 'audio/wav' } });

describe('agent speech lifecycle', () => {
  it('calls the native fetch without binding it to the dependency object', async () => {
    const nativeFetch = vi.fn(function (this: unknown) {
      if (this !== undefined) throw new TypeError('Illegal invocation');
      return Promise.resolve(response());
    });
    vi.stubGlobal('fetch', nativeFetch);
    const f = fixture();
    try { await f.playback.read(input('first')); expect(nativeFetch).toHaveBeenCalled(); expect(f.audios).toHaveLength(1); expect(f.system.speak).not.toHaveBeenCalled(); }
    finally { f.playback.stop(); vi.unstubAllGlobals(); }
  });
  it('does not play or fall back when an ignored abort returns late', async () => {
    const pending = deferred<Response>(); let signal: AbortSignal | undefined;
    const f = fixture(((_url, init) => { signal = init?.signal as AbortSignal; return pending.promise; }) as typeof fetch);
    const running = f.playback.read(input('first')); f.playback.stop();
    expect(signal?.aborted).toBe(true); pending.resolve(response()); await running;
    expect(f.audios).toHaveLength(0); expect(f.system.speak).not.toHaveBeenCalled();
    expect(f.states.at(-1)).toEqual({ messageId: null, phase: 'idle' });
  });
  it('ignores late blob decoding after switching to another message', async () => {
    const blob = deferred<Blob>(); const first = response(); first.blob = () => blob.promise;
    const f = fixture(vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(response()));
    const old = f.playback.read(input('first')); await Promise.resolve();
    await f.playback.read(input('second')); blob.resolve(new Blob(['old'])); await old;
    expect(f.audios).toHaveLength(1); expect(f.states.at(-1)?.messageId).toBe('second'); f.playback.stop();
  });
  it('old ended callbacks cannot stop new audio and object URLs are released once', async () => {
    const f = fixture(vi.fn().mockImplementation(async () => response()));
    await f.playback.read(input('first')); const oldEnd = f.audios[0].onended!;
    await f.playback.read(input('second')); oldEnd();
    expect(f.states.at(-1)).toEqual({ messageId: 'second', phase: 'speaking' });
    expect(f.audios[1].pause).not.toHaveBeenCalled(); f.playback.stop(); f.playback.stop();
    expect(f.revoke).toHaveBeenCalledTimes(2); expect(f.audios[1].pause).toHaveBeenCalledTimes(1);
  });
  it('does not duck music until playback and stops the same generating message', async () => {
    const pending = deferred<Response>(); const f = fixture(vi.fn().mockReturnValue(pending.promise));
    const running = f.playback.read(input('first'));
    expect(f.states.at(-1)?.phase).toBe('generating'); expect(f.states.some(s => s.phase === 'speaking')).toBe(false);
    await f.playback.read(input('first')); pending.resolve(response()); await running;
    expect(f.audios).toHaveLength(0); expect(f.states.at(-1)?.phase).toBe('idle');
  });
  it('reports Kokoro fallback and protects the newer speech from old system events', async () => {
    const f = fixture(vi.fn().mockResolvedValueOnce(new Response('', { status: 502 })).mockResolvedValueOnce(new Response('audio', { headers: { 'x-agent-voice-fallback': 'true' } })));
    await f.playback.read(input('first')); const oldEnd = f.system.speak.mock.calls[0][0].onend;
    await f.playback.read(input('second')); oldEnd();
    expect(f.notice).toHaveBeenLastCalledWith(expect.stringContaining('Kokoro'));
    expect(f.states.at(-1)?.messageId).toBe('second'); f.playback.stop();
  });
  it('does not substitute a different voice for a failed preview', async () => {
    const f = fixture(vi.fn().mockResolvedValue(new Response('', { status: 502 })));
    await f.playback.read(input('voice-preview')); expect(f.system.speak).not.toHaveBeenCalled(); expect(f.states.at(-1)?.phase).toBe('idle');
  });
});

describe('agent IME submission', () => {
  it('reserves Enter during composition, including the keyCode 229 compatibility case', () => {
    const enter = { key: 'Enter', shiftKey: false };
    expect(shouldSubmitAgentInput(enter, true)).toBe(false);
    expect(shouldSubmitAgentInput({ ...enter, isComposing: true }, false)).toBe(false);
    expect(shouldSubmitAgentInput({ ...enter, keyCode: 229 }, false)).toBe(false);
    expect(shouldSubmitAgentInput({ ...enter, shiftKey: true }, false)).toBe(false);
    expect(shouldSubmitAgentInput(enter, false)).toBe(true);
  });
});
