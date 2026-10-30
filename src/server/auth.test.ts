import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { clearSessionCookie, hashPassword, setSessionCookie, verifyPassword } from './auth.js';

function secureFlag(protocol: 'http' | 'https') {
  const setCookie = vi.fn(); const clearCookie = vi.fn();
  const reply = { setCookie, clearCookie } as unknown as FastifyReply;
  const request = { protocol } as unknown as FastifyRequest;
  setSessionCookie(reply, request, 'token'); clearSessionCookie(reply, request);
  expect(clearCookie.mock.calls[0][1].secure).toBe(setCookie.mock.calls[0][2].secure);
  return setCookie.mock.calls[0][2].secure;
}

describe('session cookie security', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('keeps a local HTTP development session usable', () => {
    vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('COOKIE_SECURE', '');
    expect(secureFlag('http')).toBe(false);
  });

  it('honours an explicit COOKIE_SECURE even on plain HTTP', () => {
    vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('COOKIE_SECURE', 'true');
    expect(secureFlag('http')).toBe(true);
  });

  it('always marks production cookies secure, including behind a proxy reporting HTTP', () => {
    vi.stubEnv('NODE_ENV', 'production'); vi.stubEnv('COOKIE_SECURE', '');
    expect(secureFlag('http')).toBe(true);
  });

  it('marks any HTTPS request secure', () => {
    vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('COOKIE_SECURE', '');
    expect(secureFlag('https')).toBe(true);
  });
});

describe('password hashing', () => {
  it('uses a random salt and verifies without storing plaintext', async () => {
    const first = await hashPassword('correct horse battery staple');
    const second = await hashPassword('correct horse battery staple');
    expect(first.hash).not.toBe('correct horse battery staple');
    expect(first.hash).not.toBe(second.hash);
    expect(await verifyPassword('correct horse battery staple', first.salt, first.hash)).toBe(true);
    expect(await verifyPassword('wrong password', first.salt, first.hash)).toBe(false);
  });
});
