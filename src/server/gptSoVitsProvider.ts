import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

export interface GptSoVitsConfig {
  enabled: boolean; root: string; endpoint: string; port: number; python: string; configPath: string;
  gptWeights: string; sovitsWeights: string; refAudio: string; refText: string; idleMs: number;
}

const within = (root: string, path: string) => {
  const value = relative(resolve(root), resolve(path));
  return value === '' || (!value.startsWith('..') && !isAbsolute(value));
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
  const safe = [python, gptWeights, sovitsWeights, refAudio].every(path => within(root, path));
  return {
    enabled: env.GPT_SOVITS_TTS_ENABLED === 'true' && safe && Boolean(env.GPT_SOVITS_ROOT && env.GPT_SOVITS_REF_AUDIO),
    root, endpoint: localEndpoint(port), port, python, configPath, gptWeights, sovitsWeights, refAudio,
    refText: env.GPT_SOVITS_REF_TEXT?.trim() || '过来到姐姐这儿来。',
    idleMs: Math.max(60_000, Number(env.GPT_SOVITS_IDLE_MINUTES || 15) * 60_000)
  };
}

function yamlString(value: string) { return JSON.stringify(value.replace(/\\/g, '/')); }

export class GptSoVitsProvider {
  readonly model = 'GPT-SoVITS-v2Pro';
  private child: ChildProcessWithoutNullStreams | null = null;
  private starting: Promise<void> | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  constructor(readonly config = loadGptSoVitsConfig(), private readonly fetcher: typeof fetch = fetch) {}
  configured() { return this.config.enabled; }
  private async reachable() {
    try { const response = await this.fetcher(`${this.config.endpoint}/openapi.json`, { signal: AbortSignal.timeout(800) }); return response.ok; }
    catch { return false; }
  }
  private async writeConfig() {
    await mkdir(resolve(this.config.configPath, '..'), { recursive: true });
    const body = `custom:\n  device: cuda\n  is_half: true\n  version: v2Pro\n  t2s_weights_path: ${yamlString(this.config.gptWeights)}\n  vits_weights_path: ${yamlString(this.config.sovitsWeights)}\n  bert_base_path: ${yamlString(resolve(this.config.root, 'GPT_SoVITS/pretrained_models/chinese-roberta-wwm-ext-large'))}\n  cnhuhbert_base_path: ${yamlString(resolve(this.config.root, 'GPT_SoVITS/pretrained_models/chinese-hubert-base'))}\n  bigvgan_path: ${yamlString(resolve(this.config.root, 'GPT_SoVITS/pretrained_models/models--nvidia--bigvgan_v2_24khz_100band_256x'))}\n`;
    await writeFile(this.config.configPath, body, 'utf8');
  }
  private async ensureReady() {
    if (!this.configured()) throw new Error('GPT_SOVITS_NOT_CONFIGURED');
    if (await this.reachable()) return;
    if (!this.starting) this.starting = (async () => {
      await this.writeConfig();
      this.child = spawn(this.config.python, ['api_v2.py', '-a', '127.0.0.1', '-p', String(this.config.port), '-c', this.config.configPath], { cwd: this.config.root, windowsHide: true, shell: false });
      this.child.once('exit', () => { this.child = null; });
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) { if (await this.reachable()) return; await new Promise(resolveWait => setTimeout(resolveWait, 750)); }
      this.child?.kill(); throw new Error('GPT_SOVITS_START_TIMEOUT');
    })().finally(() => { this.starting = null; });
    await this.starting;
  }
  private touch() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => { this.child?.kill(); this.child = null; }, this.config.idleMs);
    this.idleTimer.unref();
  }
  async synthesize(input: { text: string; persona?: 'warm' | 'bright' | 'poetic'; signal?: AbortSignal }) {
    await this.ensureReady(); this.touch();
    const speed = input.persona === 'bright' ? 1.05 : input.persona === 'poetic' ? .94 : 1;
    const response = await this.fetcher(`${this.config.endpoint}/tts`, {
      method: 'POST', signal: input.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        text: input.text, text_lang: 'zh', ref_audio_path: this.config.refAudio, prompt_lang: 'zh', prompt_text: this.config.refText,
        text_split_method: 'cut5', batch_size: 1, speed_factor: speed, media_type: 'wav', streaming_mode: 0
      })
    });
    if (!response.ok) throw new Error(`GPT_SOVITS_${response.status}`);
    const audio = Buffer.from(await response.arrayBuffer());
    if (!audio.length || audio.length > 32 * 1024 * 1024) throw new Error('TTS_AUDIO_INVALID');
    return { audio, contentType: 'audio/wav' };
  }
}
