export interface EncryptedAgentArchive {
  format: 'zhenqi-agent-archive';
  version: 1;
  kdf: { name: 'PBKDF2-SHA-256'; iterations: number; salt: string };
  cipher: { name: 'AES-256-GCM'; iv: string; ciphertext: string };
}

const ITERATIONS = 250_000;
const encoder = new TextEncoder(); const decoder = new TextDecoder();

function base64(bytes: Uint8Array): string {
  let value = ''; for (const byte of bytes) value += String.fromCharCode(byte); return btoa(value);
}

function unbase64(value: string): Uint8Array {
  const decoded = atob(value); return Uint8Array.from(decoded, character => character.charCodeAt(0));
}

async function archiveKey(password: string, salt: Uint8Array, iterations: number, usage: KeyUsage[]): Promise<CryptoKey> {
  if (password.length < 8 || password.length > 200) throw new Error('档案密码需要 8–200 个字符。');
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, usage);
}

export async function encryptAgentArchive(value: unknown, password: string): Promise<EncryptedAgentArchive> {
  const salt = crypto.getRandomValues(new Uint8Array(16)); const iv = crypto.getRandomValues(new Uint8Array(12)); const key = await archiveKey(password, salt, ITERATIONS, ['encrypt']);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(value))));
  return { format: 'zhenqi-agent-archive', version: 1, kdf: { name: 'PBKDF2-SHA-256', iterations: ITERATIONS, salt: base64(salt) }, cipher: { name: 'AES-256-GCM', iv: base64(iv), ciphertext: base64(encrypted) } };
}

export async function decryptAgentArchive(value: EncryptedAgentArchive, password: string): Promise<unknown> {
  if (value?.format !== 'zhenqi-agent-archive' || value.version !== 1 || value.kdf?.name !== 'PBKDF2-SHA-256' || value.cipher?.name !== 'AES-256-GCM') throw new Error('这不是受支持的珍奇档案。');
  if (!Number.isInteger(value.kdf.iterations) || value.kdf.iterations < 200_000 || value.kdf.iterations > 1_000_000) throw new Error('档案加密参数不安全或无法识别。');
  try {
    const salt = unbase64(value.kdf.salt); const iv = unbase64(value.cipher.iv); const ciphertext = unbase64(value.cipher.ciphertext); const key = await archiveKey(password, salt, value.kdf.iterations, ['decrypt']);
    return JSON.parse(decoder.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ciphertext as BufferSource)));
  } catch { throw new Error('档案密码不正确，或文件已经损坏。'); }
}
