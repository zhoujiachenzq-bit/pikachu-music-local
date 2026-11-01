export function isLikelyKuwoRestrictionAudio(contentLength: number, trackDurationMs = 0): boolean {
  if (!Number.isFinite(contentLength) || contentLength <= 0) return false;
  if (contentLength <= 300_000) return true;
  if (trackDurationMs >= 60_000) {
    const minimumPlausibleBytes = trackDurationMs / 1000 * 4_000;
    return contentLength < minimumPlausibleBytes;
  }
  return false;
}

export function audioSignature(bytes: Uint8Array): string | null {
  const at = (text: string, offset = 0) => bytes.length >= offset + text.length && [...text].every((c, i) => bytes[offset + i] === c.charCodeAt(0));
  if (at('ID3') || bytes.length >= 4 && bytes[0] === 255 && (bytes[1] & 224) === 224 && (bytes[1] & 6) !== 0 && (bytes[2] & 240) !== 240) return 'audio/mpeg';
  if (at('fLaC')) return 'audio/flac';
  if (at('OggS')) return 'audio/ogg';
  if (at('RIFF') && at('WAVE', 8)) return 'audio/wav';
  if (at('ftyp', 4)) return 'audio/mp4';
  if (bytes.length >= 4 && bytes[0] === 255 && (bytes[1] & 246) === 240) return 'audio/aac';
  return null;
}

// Validate a bounded prefix, then put every consumed byte back into the stream.
// MIME alone is insufficient: several providers answer audio requests with JSON 200.
export async function validatedAudioResponse(response: Response, options: { fromStart: boolean; source: string; durationMs?: number; timeoutMs: number; trustedType?: string }): Promise<Response | null> {
  const reject = async () => { await response.body?.cancel().catch(() => undefined); return null; };
  if (![200, 206].includes(response.status) || !response.body) return reject();
  const declaredType = (response.headers.get('content-type') || '').toLowerCase();
  if (/json|xml/.test(declaredType)) return reject();
  const fromStart = response.status === 200 || options.fromStart;
  const range = response.headers.get('content-range');
  const size = range?.match(/\/(\d+)$/)?.[1] ?? (response.status === 200 ? response.headers.get('content-length') : null);
  if (options.source === 'kuwo' && isLikelyKuwoRestrictionAudio(Number(size || 0), options.durationMs)) return reject();
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0; let ended = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([(async () => {
      while (total < 32) {
        const { done, value } = await reader.read(); if (done) { ended = true; break; }
        chunks.push(value); total += value.length;
      }
    })(), new Promise<never>((_, fail) => { timer = setTimeout(() => fail(new Error('音频响应读取超时。')), options.timeoutMs); })]);
    const prefix = new Uint8Array(Math.min(total, 32)); let offset = 0;
    for (const chunk of chunks) { const part = chunk.subarray(0, prefix.length - offset); prefix.set(part, offset); offset += part.length; if (offset === prefix.length) break; }
    const detectedType = fromStart ? audioSignature(prefix) : options.trustedType;
    const htmlError = /html/.test(declaredType) && /^\s*</.test(new TextDecoder().decode(prefix));
    if (!total || fromStart && (total < 12 || !detectedType) || htmlError || !fromStart && !detectedType && !/^(audio\/|application\/octet-stream)/.test(declaredType)) {
      await reader.cancel().catch(() => undefined); return null;
    }
    const headers = new Headers(response.headers);
    if (detectedType) headers.set('content-type', detectedType);
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) { for (const chunk of chunks) controller.enqueue(chunk); if (ended) controller.close(); },
      async pull(controller) { if (ended) return; try { const { done, value } = await reader.read(); if (done) { ended = true; controller.close(); } else controller.enqueue(value); } catch (error) { controller.error(error); } },
      cancel(reason) { return reader.cancel(reason); }
    }), { status: response.status, statusText: response.statusText, headers });
  } catch { await reader.cancel().catch(() => undefined); return null; }
  finally { if (timer) clearTimeout(timer); }
}
