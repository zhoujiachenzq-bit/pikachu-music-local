import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, writeFile, realpath, stat, lstat, rename, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import PQueue from 'p-queue';
import { abortable, boundedDuration, deadline } from '../shared/asyncControl.js';

export interface GptSoVitsConfig {
  enabled: boolean; root: string; endpoint: string; port: number; python: string; configPath: string;
  gptWeights: string; sovitsWeights: string; refAudio: string; refText: string; idleMs: number;
  configRoot: string; startMs: number; queueMs: number; inferenceMs: number;
}

const within = (root: string, path: string) => {
  const value = relative(resolve(root), resolve(path));
  return value === '' || (value !== '..' && !value.startsWith('..\\') && !value.startsWith('../') && !isAbsolute(value));
};
const localEndpoint = (port: number) => `http://127.0.0.1:${port}`;
const rooted = (root: string, value: string) => resolve(root, value);

export function loadGptSoVitsConfig(env: NodeJS.ProcessEnv = process.env): GptSoVitsConfig {
  const root = resolve(env.GPT_SOVITS_ROOT?.trim() || '.');
  const port = Math.min(65535, Math.max(1024, Number(env.GPT_SOVITS_TTS_PORT || 9881) || 9881));
  const python = rooted(root, env.GPT_SOVITS_PYTHON?.trim() || 'runtime/python.exe');
  const gptWeights = rooted(root, env.GPT_SOVITS_GPT_WEIGHTS?.trim() || 'GPT_weights_v2Pro/xxx-e15.ckpt');
  const sovitsWeights = rooted(root, env.GPT_SOVITS_SOVITS_WEIGHTS?.trim() || 'SoVITS_weights_v2Pro/xxx_e8_s152.pth');
  const refAudio = rooted(root, env.GPT_SOVITS_REF_AUDIO?.trim() || '');
  const configPath = resolve(env.GPT_SOVITS_CONFIG_PATH?.trim() || 'data/gpt-sovits/tts-infer-zhenqi.yaml');
  const configRoot = resolve('data/gpt-sovits');
  const safe = [python, gptWeights, sovitsWeights, refAudio].every(path => within(root, path)) && within(configRoot, configPath);
  return {
    enabled: env.GPT_SOVITS_TTS_ENABLED === 'true' && safe && Boolean(env.GPT_SOVITS_ROOT && env.GPT_SOVITS_REF_AUDIO),
    root, endpoint: localEndpoint(port), port, python, configPath, gptWeights, sovitsWeights, refAudio,
    refText: env.GPT_SOVITS_REF_TEXT?.trim() || '过来到姐姐这儿来。',
    idleMs: boundedDuration(env.GPT_SOVITS_IDLE_MINUTES, 15, 1, 120) * 60_000,
    configRoot,
    startMs: boundedDuration(env.GPT_SOVITS_START_TIMEOUT_MS, 120_000, 1000, 600_000),
    queueMs: boundedDuration(env.GPT_SOVITS_QUEUE_TIMEOUT_MS, 120_000, 1000, 600_000),
    inferenceMs: boundedDuration(env.GPT_SOVITS_INFERENCE_TIMEOUT_MS, 120_000, 1000, 600_000)
  };
}

function yamlString(value: string) { return JSON.stringify(value.replace(/\\/g, '/')); }

async function portAvailable(port: number) {
  return new Promise<boolean>(resolveResult => {
    const probe = createServer(); probe.unref();
    probe.once('error', () => resolveResult(false));
    probe.listen({ port, host: '127.0.0.1', exclusive: true }, () => probe.close(() => resolveResult(true)));
  });
}

type VoiceSpawner = (python: string, args: string[], options: { cwd: string; windowsHide: boolean; shell: false }) => ChildProcessWithoutNullStreams;
interface VoiceProcess {
  child: ChildProcessWithoutNullStreams; failure: AbortController; ended: Promise<void>; ready: boolean; stopping: boolean;
}

export interface GptSoVitsDependencies { spawn?: VoiceSpawner; portAvailable?: typeof portAvailable; pollMs?: number; }

/** Validate the real file targets, not just lexical '..' segments. */
export async function validateGptSoVitsPaths(config: GptSoVitsConfig) {
  const root = await realpath(config.root);
  for (const path of [config.python, config.gptWeights, config.sovitsWeights, config.refAudio, resolve(config.root, 'api_v2.py')]) {
    if (!within(root, await realpath(path)) || !(await stat(path)).isFile()) throw new Error('GPT_SOVITS_PATH_INVALID');
  }
  if (!within(config.configRoot, config.configPath)) throw new Error('GPT_SOVITS_CONFIG_PATH_INVALID');
  const project = await realpath(resolve(config.configRoot, '../..'));
  // Check the nearest existing parent before mkdir, including Windows junctions.
  let parent = dirname(config.configPath);
  for (;;) {
    try { if (!within(project, await realpath(parent))) throw new Error('GPT_SOVITS_CONFIG_PATH_INVALID'); break; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; const next = dirname(parent); if (next === parent) throw error; parent = next; }
  }
  await mkdir(dirname(config.configPath), { recursive: true });
  const actualDirectory = await realpath(dirname(config.configPath));
  if (!within(project, actualDirectory) || !within(await realpath(config.configRoot), actualDirectory)) throw new Error('GPT_SOVITS_CONFIG_PATH_INVALID');
  try { if ((await lstat(config.configPath)).isSymbolicLink()) throw new Error('GPT_SOVITS_CONFIG_PATH_INVALID'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

export class GptSoVitsProvider {
  readonly model = 'GPT-SoVITS-v2Pro';
  private process: VoiceProcess | null = null;
  private readonly queue = new PQueue({ concurrency: 1 });
  private readonly shutdown = new AbortController();
  private idleTimer: NodeJS.Timeout | null = null;
  private closing: Promise<void> | null = null;
  constructor(readonly config = loadGptSoVitsConfig(), private readonly fetcher: typeof fetch = fetch, private readonly dependencies: GptSoVitsDependencies = {}) {
    this.queue.on('idle', () => this.scheduleIdle());
  }
  configured() { return this.config.enabled; }
  private async reachable(signal: AbortSignal) {
    const timeout = deadline(800, signal);
    try { const response = await abortable(this.fetcher(`${this.config.endpoint}/openapi.json`, { signal: timeout.signal }), timeout.signal); await response.body?.cancel(); return response.ok; }
    catch { return false; } finally { timeout.dispose(); }
  }
  private async writeConfig() {
    await mkdir(resolve(this.config.configPath, '..'), { recursive: true });
    const body = `custom:\n  device: cuda\n  is_half: true\n  version: v2Pro\n  t2s_weights_path: ${yamlString(this.config.gptWeights)}\n  vits_weights_path: ${yamlString(this.config.sovitsWeights)}\n  bert_base_path: ${yamlString(resolve(this.config.root, 'GPT_SoVITS/pretrained_models/chinese-roberta-wwm-ext-large'))}\n  cnhuhbert_base_path: ${yamlString(resolve(this.config.root, 'GPT_SoVITS/pretrained_models/chinese-hubert-base'))}\n  bigvgan_path: ${yamlString(resolve(this.config.root, 'GPT_SoVITS/pretrained_models/models--nvidia--bigvgan_v2_24khz_100band_256x'))}\n`;
    const temporary = `${this.config.configPath}.${randomUUID()}.tmp`;
    try { await writeFile(temporary, body, { encoding: 'utf8', flag: 'wx' }); await rename(temporary, this.config.configPath); }
    finally { await unlink(temporary).catch(() => undefined); }
  }
  private clearIdle() { if (this.idleTimer) clearTimeout(this.idleTimer); this.idleTimer = null; }
  private async stopOwned() {
    const owner = this.process; if (!owner) return;
    owner.ready = false;
    if (!owner.stopping) { owner.stopping = true; owner.child.kill(); }
    const timeout = deadline(5000, undefined, 'GPT_SOVITS_STOP_TIMEOUT');
    try { await abortable(owner.ended, timeout.signal); } finally { timeout.dispose(); }
  }
  private async ensureReady(signal: AbortSignal) {
    if (!this.configured()) throw new Error('GPT_SOVITS_NOT_CONFIGURED');
    signal.throwIfAborted();
    if (this.process?.stopping) await this.stopOwned();
    if (this.process?.ready) return this.process;
    // A reachable HTTP service is not proof that it is our model. Never adopt it.
    await validateGptSoVitsPaths(this.config); signal.throwIfAborted();
    if (!await (this.dependencies.portAvailable || portAvailable)(this.config.port)) throw new Error('GPT_SOVITS_PORT_IN_USE');
    signal.throwIfAborted();
    const start = deadline(this.config.startMs, signal, 'GPT_SOVITS_START_TIMEOUT');
    try {
      await this.writeConfig();
      start.signal.throwIfAborted();
      const child = (this.dependencies.spawn || spawn)(this.config.python, ['api_v2.py', '-a', '127.0.0.1', '-p', String(this.config.port), '-c', this.config.configPath], { cwd: this.config.root, windowsHide: true, shell: false });
      let ended!: () => void;
      const owner: VoiceProcess = { child, failure: new AbortController(), ended: new Promise(resolveEnd => { ended = resolveEnd; }), ready: false, stopping: false };
      this.process = owner;
      const finish = (code: string) => { owner.failure.abort(new Error(code)); if (this.process === owner) this.process = null; ended(); };
      child.once('error', () => finish('GPT_SOVITS_START_FAILED'));
      child.once('exit', () => finish('GPT_SOVITS_EXITED'));
      // Drain rather than buffer/log: output may contain reference text and paths.
      child.stdout.resume(); child.stderr.resume(); child.stdin.end();
      const readySignal = AbortSignal.any([start.signal, owner.failure.signal]);
      for (;;) {
        readySignal.throwIfAborted();
        if (await this.reachable(readySignal)) { readySignal.throwIfAborted(); owner.ready = true; return owner; }
        readySignal.throwIfAborted();
        await delay(this.dependencies.pollMs ?? 750, undefined, { signal: readySignal }).catch(() => readySignal.throwIfAborted());
      }
    } catch (error) { await this.stopOwned(); throw error; }
    finally { start.dispose(); }
  }
  private scheduleIdle() {
    this.clearIdle();
    if (this.shutdown.signal.aborted || this.queue.size || this.queue.pending || !this.process) return;
    this.idleTimer = setTimeout(() => { void this.stopOwned().catch(() => undefined); }, this.config.idleMs);
    this.idleTimer.unref();
  }
  private async infer(input: { text: string; persona?: 'warm' | 'bright' | 'poetic' }, owner: VoiceProcess) {
    const timeout = deadline(this.config.inferenceMs, this.shutdown.signal, 'GPT_SOVITS_INFERENCE_TIMEOUT');
    const signal = AbortSignal.any([timeout.signal, owner.failure.signal]);
    const speed = input.persona === 'bright' ? 1.05 : input.persona === 'poetic' ? .94 : 1;
    try {
    const response = await abortable(this.fetcher(`${this.config.endpoint}/tts`, {
      method: 'POST', signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        text: input.text, text_lang: 'zh', ref_audio_path: this.config.refAudio, prompt_lang: 'zh', prompt_text: this.config.refText,
        text_split_method: 'cut5', batch_size: 1, speed_factor: speed, media_type: 'wav', streaming_mode: 0
      })
    }), signal);
    if (!response.ok) throw new Error(`GPT_SOVITS_${response.status}`);
    const reader = response.body?.getReader(); if (!reader) throw new Error('TTS_AUDIO_INVALID');
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) { const part = await abortable(reader.read(), signal); if (part.done) break; size += part.value.length; if (size > 32 * 1024 * 1024) throw new Error('TTS_AUDIO_INVALID'); chunks.push(part.value); }
    } finally { void reader.cancel().catch(() => undefined); }
    const audio = Buffer.concat(chunks);
    if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') throw new Error('TTS_AUDIO_INVALID');
    return { audio, contentType: 'audio/wav' };
    } catch (error) { await this.stopOwned(); throw error; }
    finally { timeout.dispose(); }
  }
  async synthesize(input: { text: string; persona?: 'warm' | 'bright' | 'poetic'; signal?: AbortSignal }) {
    this.shutdown.signal.throwIfAborted(); input.signal?.throwIfAborted(); this.clearIdle();
    const caller = input.signal ? AbortSignal.any([input.signal, this.shutdown.signal]) : this.shutdown.signal;
    const waiting = deadline(this.config.queueMs, caller, 'GPT_SOVITS_QUEUE_TIMEOUT');
    // p-queue's running-task cancellation releases its slot before work stops.
    // Remove cancellation at dequeue, and keep our caller wait separate instead.
    const queued = new AbortController(); const cancelQueued = () => queued.abort(waiting.signal.reason);
    waiting.signal.addEventListener('abort', cancelQueued, { once: true });
    const work = this.queue.add(async () => {
      waiting.signal.removeEventListener('abort', cancelQueued); waiting.dispose();
      caller.throwIfAborted();
      const owner = await this.ensureReady(caller); caller.throwIfAborted();
      return this.infer(input, owner);
    }, { signal: queued.signal });
    void work.finally(() => { waiting.dispose(); waiting.signal.removeEventListener('abort', cancelQueued); this.scheduleIdle(); }).catch(() => undefined);
    return abortable(work, caller);
  }
  dispose(): Promise<void> {
    if (!this.closing) this.closing = (async () => {
      this.clearIdle(); this.shutdown.abort(new Error('GPT_SOVITS_CLOSED'));
      await this.stopOwned();
      const timeout = deadline(6000, undefined, 'GPT_SOVITS_CLOSE_TIMEOUT');
      try { await abortable(this.queue.onIdle(), timeout.signal); } finally { timeout.dispose(); }
    })();
    return this.closing;
  }
}
