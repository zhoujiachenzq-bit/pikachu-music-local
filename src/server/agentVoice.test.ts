import { describe, expect, it } from 'vitest';
import { decodeAgentAudioBase64, normalizeAgentAudioMime } from './agentVoice.js';

describe('agent voice privacy boundary', () => {
  it('accepts recorder codec parameters but forwards a canonical MIME', () => {
    expect(normalizeAgentAudioMime('audio/webm;codecs=opus')).toBe('audio/webm');
    expect(normalizeAgentAudioMime(' Audio/X-WAV ; codecs=1')).toBe('audio/wav');
    expect(normalizeAgentAudioMime('video/webm')).toBeNull();
  });

  it('strictly decodes base64 and applies the raw-byte limit', () => {
    expect(decodeAgentAudioBase64(Buffer.from('voice').toString('base64'), 16).toString()).toBe('voice');
    expect(() => decodeAgentAudioBase64('not base64!')).toThrow('AGENT_AUDIO_BASE64_INVALID');
    expect(() => decodeAgentAudioBase64(Buffer.alloc(17).toString('base64'), 16)).toThrow('AGENT_AUDIO_TOO_LARGE');
  });
});
