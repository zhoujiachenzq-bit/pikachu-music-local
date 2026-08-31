import { afterEach, describe, expect, it, vi } from 'vitest';
import { GptSoVitsProvider, loadGptSoVitsConfig, validateGptSoVitsPaths } from './gptSoVitsProvider.js';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';

describe('GPT-SoVITS local configuration', () => {
  it('uses a loopback-only endpoint and accepts paths inside the configured root', () => {
    const config = loadGptSoVitsConfig({ GPT_SOVITS_TTS_ENABLED: 'true', GPT_SOVITS_ROOT: resolve('voice'), GPT_SOVITS_REF_AUDIO: 'refs/voice.wav', GPT_SOVITS_TTS_PORT: '9881' });
    expect(config.enabled).toBe(true);
    expect(config.endpoint).toBe('http://127.0.0.1:9881');
    expect(config.refAudio.toLowerCase()).toContain('voice');
  });

  it('rejects a reference path that escapes the GPT-SoVITS directory', () => {
    const config = loadGptSoVitsConfig({ GPT_SOVITS_TTS_ENABLED: 'true', GPT_SOVITS_ROOT: resolve('voice'), GPT_SOVITS_REF_AUDIO: '../secret.wav' });
    expect(config.enabled).toBe(false);
  });
});

const directories: string[] = []; const providers: GptSoVitsProvider[] = [];
afterEach(async () => { for (const provider of providers.splice(0)) await provider.dispose(); vi.useRealTimers(); for (const dir of directories.splice(0)) { if (!resolve(dir).startsWith(`${resolve(tmpdir())}${sep}zhenqi-`)) throw new Error('Refusing to delete outside test fixtures'); await rm(dir, { recursive: true, force: true }); } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function wav() { const bytes = Buffer.alloc(46); bytes.write('RIFF'); bytes.writeUInt32LE(38, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(32000, 24); bytes.writeUInt32LE(64000, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(2, 40); return new Response(bytes); }
async function fixture(fetcher?: typeof fetch) {
  const dir = await mkdtemp(join(tmpdir(), 'zhenqi-voice-test-')); directories.push(dir);
  const root = join(dir, 'model'); await mkdir(root);
  for (const file of ['python.exe', 'gpt.ckpt', 'sovits.pth', 'ref.wav', 'api_v2.py']) await writeFile(join(root, file), 'fixture');
  const config = { ...loadGptSoVitsConfig({}), enabled: true, root, python: join(root, 'python.exe'), gptWeights: join(root, 'gpt.ckpt'), sovitsWeights: join(root, 'sovits.pth'), refAudio: join(root, 'ref.wav'), configRoot: join(dir, 'data/gpt-sovits'), configPath: join(dir, 'data/gpt-sovits/infer.yaml'), startMs: 1000, queueMs: 1000, inferenceMs: 1000, idleMs: 1000 };
  const children: Array<EventEmitter & { kill: ReturnType<typeof vi.fn>; stdout: PassThrough; stderr: PassThrough; stdin: PassThrough }> = [];
  const spawn = vi.fn(() => {
    const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: vi.fn() });
    child.kill.mockImplementation(() => { queueMicrotask(() => child.emit('exit', 0)); return true; }); children.push(child); return child as unknown as ChildProcessWithoutNullStreams;
  });
  const available = vi.fn().mockResolvedValue(true);
  const fetchMock = fetcher || vi.fn(async (url: string | URL | Request) => String(url).endsWith('/openapi.json') ? new Response('{}') : wav());
  const provider = new GptSoVitsProvider(config, fetchMock, { spawn, portAvailable: available, pollMs: 5 }); providers.push(provider);
  return { provider, config, spawn, children, available, fetchMock, dir };
}

describe('GPT-SoVITS owned process lifecycle', () => {
  it('rejects occupied ports without adopting or killing another service', async () => {
    const f = await fixture(); f.available.mockResolvedValue(false);
    await expect(f.provider.synthesize({ text: 'test' })).rejects.toThrow('GPT_SOVITS_PORT_IN_USE'); expect(f.spawn).not.toHaveBeenCalled();
  });
  it('handles spawn error events and drains both output pipes', async () => {
    const f = await fixture(); const original = f.spawn.getMockImplementation()!;
    f.spawn.mockImplementation(() => { const child = original(); queueMicrotask(() => child.emit('error', new Error('fixture spawn failure'))); return child; });
    await expect(f.provider.synthesize({ text: 'test' })).rejects.toThrow('GPT_SOVITS_START_FAILED');
    expect(f.children[0].stdout.readableFlowing).toBe(true); expect(f.children[0].stderr.readableFlowing).toBe(true);
  });
  it('keeps the model and the queue slot until abandoned inference actually finishes', async () => {
    const pending = deferred<Response>(); let calls = 0; let modelSignal: AbortSignal | undefined;
    const f = await fixture((async (url, init) => { if (String(url).endsWith('/openapi.json')) return new Response('{}'); ++calls; modelSignal = init?.signal as AbortSignal; return calls === 1 ? pending.promise : wav(); }) as typeof fetch);
    const caller = new AbortController(); const first = f.provider.synthesize({ text: 'first', signal: caller.signal }); const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(calls).toBe(1)); caller.abort(); await rejected;
    expect(modelSignal?.aborted).toBe(false);
    const second = f.provider.synthesize({ text: 'second' }); await new Promise(r => setTimeout(r, 20)); expect(calls).toBe(1);
    pending.resolve(wav()); await second; expect(calls).toBe(2); expect(f.spawn).toHaveBeenCalledTimes(1); expect(f.children[0].kill).not.toHaveBeenCalled();
  });
  it('removes cancelled queued work without starting it or falling back', async () => {
    const pending = deferred<Response>(); let calls = 0;
    const f = await fixture((async url => String(url).endsWith('/openapi.json') ? new Response('{}') : (++calls, pending.promise)) as typeof fetch);
    const first = f.provider.synthesize({ text: 'first' }); await vi.waitFor(() => expect(calls).toBe(1));
    const controller = new AbortController(); const second = f.provider.synthesize({ text: 'queued', signal: controller.signal }); const rejected = expect(second).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await rejected;
    pending.resolve(wav()); await first; expect(calls).toBe(1);
  });
  it('cancels cold startup and kills only its own child', async () => {
    const f = await fixture(vi.fn().mockRejectedValue(new Error('not ready'))); const caller = new AbortController();
    const work = f.provider.synthesize({ text: 'first', signal: caller.signal }); const rejected = expect(work).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(f.spawn).toHaveBeenCalledTimes(1)); caller.abort(); await rejected;
    await vi.waitFor(() => expect(f.children[0].kill).toHaveBeenCalled());
  });
  it('bounds inference even if the HTTP provider ignores cancellation', async () => {
    const f = await fixture((async url => String(url).endsWith('/openapi.json') ? new Response('{}') : new Promise<Response>(() => {})) as typeof fetch); f.config.inferenceMs = 30;
    await expect(f.provider.synthesize({ text: 'first' })).rejects.toThrow('GPT_SOVITS_INFERENCE_TIMEOUT'); expect(f.children[0].kill).toHaveBeenCalled();
  });
  it('starts idle expiry after work completes and closes idempotently', async () => {
    const f = await fixture(); f.config.idleMs = 30;
    await f.provider.synthesize({ text: 'first' }); await vi.waitFor(() => expect(f.children[0].kill).toHaveBeenCalledTimes(1));
    await f.provider.dispose(); await f.provider.dispose(); await expect(f.provider.synthesize({ text: 'late' })).rejects.toThrow('GPT_SOVITS_CLOSED');
  });
  it('closes running and queued work without killing its child twice', async () => {
    let calls = 0;
    const f = await fixture((async url => String(url).endsWith('/openapi.json') ? new Response('{}') : (++calls, new Promise<Response>(() => {}))) as typeof fetch);
    const first = f.provider.synthesize({ text: 'running' });
    const firstRejected = expect(first).rejects.toThrow('GPT_SOVITS_CLOSED');
    await vi.waitFor(() => expect(calls).toBe(1));
    const second = f.provider.synthesize({ text: 'queued' });
    const secondRejected = expect(second).rejects.toThrow('GPT_SOVITS_CLOSED');
    await f.provider.dispose(); await Promise.all([firstRejected, secondRejected]);
    expect(calls).toBe(1); expect(f.children[0].kill).toHaveBeenCalledTimes(1);
  });
  it('expires queued work without interrupting inference or starting a second call', async () => {
    const pending = deferred<Response>(); let calls = 0;
    const f = await fixture((async url => String(url).endsWith('/openapi.json') ? new Response('{}') : (++calls, pending.promise)) as typeof fetch);
    const first = f.provider.synthesize({ text: 'running' });
    await vi.waitFor(() => expect(calls).toBe(1)); f.config.queueMs = 30;
    await expect(f.provider.synthesize({ text: 'queued' })).rejects.toThrow('GPT_SOVITS_QUEUE_TIMEOUT');
    expect(f.children[0].kill).not.toHaveBeenCalled(); pending.resolve(wav()); await first; expect(calls).toBe(1);
  });
  it('does not expire the model while inference is active', async () => {
    const pending = deferred<Response>(); let calls = 0;
    const f = await fixture((async url => String(url).endsWith('/openapi.json') ? new Response('{}') : (++calls, pending.promise)) as typeof fetch);
    f.config.idleMs = 30;
    const first = f.provider.synthesize({ text: 'running' }); await vi.waitFor(() => expect(calls).toBe(1));
    await new Promise(r => setTimeout(r, 50)); expect(f.children[0].kill).not.toHaveBeenCalled();
    pending.resolve(wav()); await first; await vi.waitFor(() => expect(f.children[0].kill).toHaveBeenCalledTimes(1));
  });
  it('reports an early child exit instead of waiting for the startup deadline', async () => {
    const f = await fixture(vi.fn().mockRejectedValue(new Error('not ready'))); const original = f.spawn.getMockImplementation()!;
    f.spawn.mockImplementation(() => { const child = original(); queueMicrotask(() => child.emit('exit', 1)); return child; });
    await expect(f.provider.synthesize({ text: 'test' })).rejects.toThrow('GPT_SOVITS_EXITED');
  });
  it('rejects a junction escape and missing model files before spawning', async () => {
    const f = await fixture(); const outside = join(f.dir, 'outside'); await mkdir(outside); await writeFile(join(outside, 'ref.wav'), 'fixture');
    await symlink(outside, join(f.config.root, 'escape'), 'junction'); f.config.refAudio = join(f.config.root, 'escape/ref.wav');
    await expect(validateGptSoVitsPaths(f.config)).rejects.toThrow('GPT_SOVITS_PATH_INVALID');
    f.config.refAudio = join(f.config.root, 'missing.wav'); await expect(f.provider.synthesize({ text: 'test' })).rejects.toThrow(); expect(f.spawn).not.toHaveBeenCalled();
  });
  it('rejects a config directory junction before creating files outside the project', async () => {
    const f = await fixture(); const other = await mkdtemp(join(tmpdir(), 'zhenqi-outside-test-')); directories.push(other);
    await symlink(other, join(f.dir, 'data'), 'junction');
    await expect(f.provider.synthesize({ text: 'test' })).rejects.toThrow('GPT_SOVITS_CONFIG_PATH_INVALID'); expect(f.spawn).not.toHaveBeenCalled();
  });
  it('uses finite bounded timeout and idle configuration', () => {
    const config = loadGptSoVitsConfig({ GPT_SOVITS_IDLE_MINUTES: 'NaN', GPT_SOVITS_INFERENCE_TIMEOUT_MS: 'Infinity', GPT_SOVITS_START_TIMEOUT_MS: '-1' });
    expect(config.idleMs).toBe(900_000); expect(config.inferenceMs).toBe(120_000); expect(config.startMs).toBe(1000);
  });
});
