import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './auth.js';

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
