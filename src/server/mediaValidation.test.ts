import { describe, expect, it } from 'vitest';
import { audioSignature, validatedAudioResponse } from './mediaValidation.js';

describe('real audio prefix validation', () => {
  it.each([['fLaC', 'audio/flac'], ['OggS', 'audio/ogg'], ['RIFF0000WAVE', 'audio/wav'], ['0000ftypisom', 'audio/mp4']])('recognizes %s without trusting MIME', (prefix, type) => {
    expect(audioSignature(new TextEncoder().encode(prefix))).toBe(type);
  });
  it('reads split chunks, repairs MIME and replays all bytes in order', async () => {
    const bytes = new Uint8Array(128); bytes.set([73, 68, 51]); let index = 0;
    const response = new Response(new ReadableStream({ pull(c) { if (index === bytes.length) c.close(); else c.enqueue(bytes.slice(index, ++index)); } }), { headers: { 'content-type': 'text/html' } });
    const valid = await validatedAudioResponse(response, { fromStart: true, source: 'jamendo', timeoutMs: 1000 });
    expect(valid?.headers.get('content-type')).toBe('audio/mpeg');
    expect(new Uint8Array(await valid!.arrayBuffer())).toEqual(bytes);
  });
  it('cancels a stalled prefix rather than waiting forever', async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array([73, 68])); }, cancel() { cancelled = true; } }));
    expect(await validatedAudioResponse(response, { fromStart: true, source: 'qq', timeoutMs: 15 })).toBeNull();
    expect(cancelled).toBe(true);
  });
  it('does not mistake the Range sample size for the whole track size', async () => {
    const bytes = new Uint8Array(64); bytes.set([73, 68, 51]);
    const response = new Response(bytes, { status: 206, headers: { 'content-range': 'bytes 0-63/5000000', 'content-length': '64' } });
    const valid = await validatedAudioResponse(response, { fromStart: true, source: 'kuwo', durationMs: 200000, timeoutMs: 1000 });
    expect(valid).not.toBeNull(); await valid?.body?.cancel();
  });
});
