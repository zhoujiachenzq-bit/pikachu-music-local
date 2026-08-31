import { json } from './api';

export type SpeechState = { messageId: string | null; phase: 'idle' | 'generating' | 'speaking' };
interface SpeechInput { text: string; messageId: string; voiceId?: string; persona: 'warm' | 'bright' | 'poetic'; lang: 'zh' | 'en'; }
interface SpeechDependencies {
  fetcher: typeof fetch;
  createAudio: (url: string) => HTMLAudioElement;
  createUrl: (blob: Blob) => string;
  revokeUrl: (url: string) => void;
  systemSpeech: SpeechSynthesis | undefined;
  createUtterance: (text: string) => SpeechSynthesisUtterance;
  onState: (state: SpeechState) => void;
  onNotice: (message: string) => void;
}

/** A single speech session. All asynchronous callbacks belong to its generation. */
export class AgentSpeechPlayback {
  private generation = 0;
  private controller: AbortController | null = null;
  private audio: HTMLAudioElement | null = null;
  private url: string | null = null;
  private utterance: SpeechSynthesisUtterance | null = null;
  private state: SpeechState = { messageId: null, phase: 'idle' };
  private readonly deps: SpeechDependencies;
  constructor(callbacks: Pick<SpeechDependencies, 'onState' | 'onNotice'>, dependencies: Partial<SpeechDependencies> = {}) {
    this.deps = { fetcher: (input, init) => fetch(input, init), createAudio: url => new Audio(url), createUrl: blob => URL.createObjectURL(blob), revokeUrl: url => URL.revokeObjectURL(url),
      systemSpeech: typeof window === 'undefined' ? undefined : window.speechSynthesis,
      createUtterance: text => new SpeechSynthesisUtterance(text), ...callbacks, ...dependencies };
  }
  private update(state: SpeechState) { this.state = state; this.deps.onState(state); }
  private releaseAudio() {
    if (this.audio) { this.audio.onended = null; this.audio.onerror = null; this.audio.pause(); this.audio.removeAttribute('src'); this.audio.load(); this.audio = null; }
    if (this.url) { this.deps.revokeUrl(this.url); this.url = null; }
  }
  stop() {
    ++this.generation;
    this.controller?.abort(); this.controller = null;
    this.releaseAudio();
    if (this.utterance) { this.utterance.onend = null; this.utterance.onerror = null; this.utterance = null; this.deps.systemSpeech?.cancel(); }
    this.update({ messageId: null, phase: 'idle' });
  }
  async read(input: SpeechInput) {
    const text = input.text.trim().slice(0, 1500); if (!text) return;
    if (this.state.messageId === input.messageId) { this.stop(); return; }
    this.stop();
    const generation = this.generation;
    const controller = new AbortController(); this.controller = controller;
    const current = () => generation === this.generation && !controller.signal.aborted;
    const stopCurrent = () => { if (current()) this.stop(); };
    const zh = input.lang === 'zh';
    this.update({ messageId: input.messageId, phase: 'generating' });
    let fallingBack = false;
    const fallback = () => {
      if (!current() || fallingBack) return;
      fallingBack = true; this.releaseAudio();
      if (input.messageId === 'voice-preview' || !this.deps.systemSpeech) {
        this.deps.onNotice(zh ? '这个音色暂时无法朗读，请稍后重试。' : 'This voice is unavailable. Please try again.'); stopCurrent(); return;
      }
      try {
        if (input.voiceId) this.deps.onNotice(zh ? '本次语音生成失败，已改用浏览器系统朗读。' : 'Using the browser voice because synthesis failed.');
        const utterance = this.deps.createUtterance(text); this.utterance = utterance;
        utterance.lang = zh ? 'zh-CN' : 'en-US'; utterance.rate = input.persona === 'bright' ? 1.06 : input.persona === 'poetic' ? .93 : 1;
        utterance.onend = stopCurrent; utterance.onerror = stopCurrent;
        this.update({ messageId: input.messageId, phase: 'speaking' }); this.deps.systemSpeech.speak(utterance);
      } catch { stopCurrent(); }
    };
    try {
      if (!input.voiceId) { fallback(); return; }
      const response = await this.deps.fetcher('/api/agent/voice/synthesize', { ...json('POST', { text, voice: input.voiceId, persona: input.persona }), signal: controller.signal });
      if (!current()) return;
      if (!response.ok) { fallback(); return; }
      const blob = await response.blob(); if (!current()) return;
      if (response.headers.get('x-agent-voice-fallback') === 'true') this.deps.onNotice(zh ? '专属音色暂不可用，本次已改用 Kokoro。' : 'Using Kokoro because the private voice is unavailable.');
      this.url = this.deps.createUrl(blob); const audio = this.deps.createAudio(this.url); this.audio = audio;
      audio.onended = stopCurrent; audio.onerror = fallback;
      this.update({ messageId: input.messageId, phase: 'speaking' }); await audio.play();
    } catch { if (current()) fallback(); }
  }
}
