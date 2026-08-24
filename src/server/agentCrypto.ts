import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

export interface AgentCiphertext {
  ciphertext: string;
  keyVersion: string;
}

interface Keyring {
  primary: string;
  keys: Map<string, Buffer>;
  developmentFallback: boolean;
}

function parseKey(value: string): Buffer {
  const trimmed = value.trim();
  const decoded = /^[a-f\d]{64}$/i.test(trimmed) ? Buffer.from(trimmed, 'hex') : Buffer.from(trimmed, 'base64');
  if (decoded.length !== 32) throw new Error('AGENT_DATA_KEY 必须是 32 字节的 Base64 或 64 位十六进制密钥。');
  return decoded;
}

export function loadAgentKeyring(env: NodeJS.ProcessEnv = process.env): Keyring {
  const primary = env.AGENT_DATA_KEY_VERSION?.trim() || 'v1';
  const keys = new Map<string, Buffer>();
  if (env.AGENT_DATA_KEYS) {
    const parsed = JSON.parse(env.AGENT_DATA_KEYS) as Record<string, string>;
    for (const [version, value] of Object.entries(parsed)) keys.set(version, parseKey(value));
  }
  if (env.AGENT_DATA_KEY) keys.set(primary, parseKey(env.AGENT_DATA_KEY));
  if (keys.has(primary)) return { primary, keys, developmentFallback: false };
  if (env.NODE_ENV === 'production') return { primary, keys, developmentFallback: false };
  keys.set('dev-v1', createHash('sha256').update('pikachu-music-zhenqi-local-development-only').digest());
  return { primary: 'dev-v1', keys, developmentFallback: true };
}

function userKey(master: Buffer, userId: string): Buffer {
  return Buffer.from(hkdfSync('sha256', master, Buffer.from(userId), Buffer.from('zhenqi-agent-record-v1'), 32));
}

function aad(userId: string, recordType: string, recordId: string, keyVersion: string): Buffer {
  return Buffer.from(`${keyVersion}\u0000${userId}\u0000${recordType}\u0000${recordId}`);
}

export function encryptAgentText(keyring: Keyring, userId: string, recordType: string, recordId: string, plaintext: string): AgentCiphertext {
  const master = keyring.keys.get(keyring.primary);
  if (!master) throw new Error('珍奇数据加密密钥未配置。');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', userKey(master, userId), iv);
  cipher.setAAD(aad(userId, recordType, recordId, keyring.primary));
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: Buffer.concat([iv, tag, encrypted]).toString('base64'), keyVersion: keyring.primary };
}

export function decryptAgentText(keyring: Keyring, userId: string, recordType: string, recordId: string, ciphertext: string, keyVersion: string): string {
  const master = keyring.keys.get(keyVersion);
  if (!master) throw new Error(`无法读取使用密钥版本 ${keyVersion} 加密的珍奇数据。`);
  const payload = Buffer.from(ciphertext, 'base64');
  if (payload.length < 29) throw new Error('珍奇加密数据已损坏。');
  const iv = payload.subarray(0, 12); const tag = payload.subarray(12, 28); const encrypted = payload.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', userKey(master, userId), iv);
  decipher.setAAD(aad(userId, recordType, recordId, keyVersion));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

export function agentCryptoConfigured(keyring: Keyring): boolean {
  return keyring.keys.has(keyring.primary);
}

export type AgentKeyring = ReturnType<typeof loadAgentKeyring>;
