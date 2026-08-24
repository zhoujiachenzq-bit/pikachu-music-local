import { describe, expect, it, vi } from 'vitest';
import { BailianSpeechProvider, loadAgentProviderConfig } from './agentProviders.js';

describe('agent speech provider', () => {
  it('accepts only audio responses from the temporary TTS URL', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ output: { audio: { url: 'https://audio.example.test/result' } } }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response('<html>not audio</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    const provider = new BailianSpeechProvider(loadAgentProviderConfig({ BAILIAN_API_KEY: 'test-key' }), fetcher as typeof fetch);
    await expect(provider.synthesize({ text: '你好', voice: 'Cherry' })).rejects.toThrow('TTS_AUDIO_TYPE_INVALID');
  });

  it('returns validated audio bytes without retaining the temporary URL', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ output: { audio: { url: 'https://audio.example.test/result' } } }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([82, 73, 70, 70]), { status: 200, headers: { 'content-type': 'audio/wav; charset=binary' } }));
    const provider = new BailianSpeechProvider(loadAgentProviderConfig({ BAILIAN_API_KEY: 'test-key' }), fetcher as typeof fetch); const result = await provider.synthesize({ text: '你好', voice: 'Cherry' });
    expect(result).toMatchObject({ contentType: 'audio/wav' }); expect([...result.audio]).toEqual([82, 73, 70, 70]);
  });
});
