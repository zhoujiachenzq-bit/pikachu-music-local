const AUDIO_MIME_ALIASES: Record<string, string> = {
  'audio/x-wav': 'audio/wav',
  'audio/wave': 'audio/wav',
  'audio/x-m4a': 'audio/mp4'
};

const ALLOWED_AUDIO_MIMES = new Set(['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/ogg']);

/** MediaRecorder usually adds codec parameters. Providers need only the canonical MIME. */
export function normalizeAgentAudioMime(value: string): string | null {
  const base = value.split(';', 1)[0]?.trim().toLocaleLowerCase() || '';
  const normalized = AUDIO_MIME_ALIASES[base] || base;
  return ALLOWED_AUDIO_MIMES.has(normalized) ? normalized : null;
}

export function decodeAgentAudioBase64(value: string, maxBytes = 10 * 1024 * 1024): Buffer {
  const normalized = value.trim();
  if (!normalized || normalized.length % 4 !== 0 || !/^[a-zA-Z0-9+/]+={0,2}$/.test(normalized)) throw new Error('AGENT_AUDIO_BASE64_INVALID');
  const bytes = Buffer.from(normalized, 'base64');
  if (!bytes.length || bytes.length > maxBytes || bytes.toString('base64') !== normalized) throw new Error(bytes.length > maxBytes ? 'AGENT_AUDIO_TOO_LARGE' : 'AGENT_AUDIO_BASE64_INVALID');
  return bytes;
}
