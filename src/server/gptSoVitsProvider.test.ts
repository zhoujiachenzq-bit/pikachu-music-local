import { describe, expect, it } from 'vitest';
import { loadGptSoVitsConfig } from './gptSoVitsProvider.js';

describe('GPT-SoVITS local configuration', () => {
  it('uses a loopback-only endpoint and accepts paths inside the configured root', () => {
    const config = loadGptSoVitsConfig({ GPT_SOVITS_TTS_ENABLED: 'true', GPT_SOVITS_ROOT: 'C:\\voice', GPT_SOVITS_REF_AUDIO: 'refs\\voice.wav', GPT_SOVITS_TTS_PORT: '9881' });
    expect(config.enabled).toBe(true);
    expect(config.endpoint).toBe('http://127.0.0.1:9881');
    expect(config.refAudio.toLowerCase()).toContain('voice');
  });

  it('rejects a reference path that escapes the GPT-SoVITS directory', () => {
    const config = loadGptSoVitsConfig({ GPT_SOVITS_TTS_ENABLED: 'true', GPT_SOVITS_ROOT: 'C:\\voice', GPT_SOVITS_REF_AUDIO: '..\\secret.wav' });
    expect(config.enabled).toBe(false);
  });
});
