import { describe, expect, it } from 'vitest';
import { decryptAgentText, encryptAgentText, loadAgentKeyring } from './agentCrypto.js';

describe('agent record encryption', () => {
  const key = Buffer.alloc(32, 7).toString('base64');

  it('encrypts each record with a random IV and binds it to its user and record id', () => {
    const keyring = loadAgentKeyring({ AGENT_DATA_KEY: key, AGENT_DATA_KEY_VERSION: 'k1' } as NodeJS.ProcessEnv);
    const first = encryptAgentText(keyring, 'user-a', 'message', 'message-1', '只属于用户 A');
    const second = encryptAgentText(keyring, 'user-a', 'message', 'message-1', '只属于用户 A');
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(decryptAgentText(keyring, 'user-a', 'message', 'message-1', first.ciphertext, first.keyVersion)).toBe('只属于用户 A');
    expect(() => decryptAgentText(keyring, 'user-b', 'message', 'message-1', first.ciphertext, first.keyVersion)).toThrow();
    expect(() => decryptAgentText(keyring, 'user-a', 'message', 'message-2', first.ciphertext, first.keyVersion)).toThrow();
  });

  it('supports decrypting an old key version during rotation', () => {
    const oldRing = loadAgentKeyring({ AGENT_DATA_KEY: key, AGENT_DATA_KEY_VERSION: 'v1' } as NodeJS.ProcessEnv);
    const encrypted = encryptAgentText(oldRing, 'user-a', 'memory', 'memory-1', '偏爱夜晚听歌');
    const next = Buffer.alloc(32, 9).toString('base64');
    const rotating = loadAgentKeyring({ AGENT_DATA_KEY_VERSION: 'v2', AGENT_DATA_KEY: next, AGENT_DATA_KEYS: JSON.stringify({ v1: key }) } as NodeJS.ProcessEnv);
    expect(decryptAgentText(rotating, 'user-a', 'memory', 'memory-1', encrypted.ciphertext, encrypted.keyVersion)).toBe('偏爱夜晚听歌');
    expect(encryptAgentText(rotating, 'user-a', 'memory', 'memory-2', '新记忆').keyVersion).toBe('v2');
  });
});
