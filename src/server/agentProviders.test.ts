import { describe, expect, it, vi } from 'vitest';
import { AgentSpeechSynthesisRegistry, AzureSpeechProvider, BailianSpeechProvider, MiniMaxSpeechProvider, loadAgentProviderConfig, loadAzureSpeechConfig, loadMiniMaxSpeechConfig } from './agentProviders.js';
import { normalizeAgentVoiceId } from '../shared/agentVoices.js';

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

  it('keeps legacy settings compatible while making Xiaoxiao the safe default', () => {
    expect(normalizeAgentVoiceId('Cherry')).toBe('azure-xiaoxiao');
    expect(normalizeAgentVoiceId('Serena')).toBe('bailian-serena');
    expect(normalizeAgentVoiceId('not-a-real-voice')).toBe('azure-xiaoxiao');
  });

  it('builds escaped Azure SSML for the Xiaoxiao profile', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(new Uint8Array([73, 68, 51]), { status: 200, headers: { 'content-type': 'audio/mpeg' } }));
    const provider = new AzureSpeechProvider(loadAzureSpeechConfig({ AZURE_SPEECH_KEY: 'azure-key', AZURE_SPEECH_REGION: 'eastasia' }), fetcher as typeof fetch);
    const result = await provider.synthesize({ text: '你 & 我 <今晚>', voice: provider.config.voice, persona: 'poetic' });
    const [url, request] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://eastasia.tts.speech.microsoft.com/cognitiveservices/v1');
    expect(request.body).toContain('你 &amp; 我 &lt;今晚&gt;'); expect(request.body).toContain('rate="-8%"');
    expect(result.contentType).toBe('audio/mpeg');
  });

  it('decodes MiniMax hex audio and uses the account voice id', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { audio: '494433' }, base_resp: { status_code: 0 } }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const provider = new MiniMaxSpeechProvider(loadMiniMaxSpeechConfig({ MINIMAX_API_KEY: 'mini-key' }), fetcher as typeof fetch);
    const result = await provider.synthesize({ text: '晚上好', voice: 'account-voice-42', persona: 'warm' });
    const request = fetcher.mock.calls[0][1] as RequestInit; const payload = JSON.parse(String(request.body));
    expect(payload.voice_setting.voice_id).toBe('account-voice-42'); expect([...result.audio]).toEqual([73, 68, 51]);
  });

  it('reports availability per voice instead of treating a provider key as every voice', () => {
    const registry = new AgentSpeechSynthesisRegistry({
      AZURE_SPEECH_KEY: 'azure-key', AZURE_SPEECH_REGION: 'eastasia', MINIMAX_API_KEY: 'mini-key', MINIMAX_VOICE_SOOTHING_HOST: 'soothing-account-id'
    });
    const options = Object.fromEntries(registry.options().map(option => [option.id, option.available]));
    expect(options['azure-xiaoxiao']).toBe(true); expect(options['minimax-soothing-host']).toBe(true); expect(options['minimax-office-man']).toBe(false); expect(options['bailian-cherry']).toBe(false);
  });
});
