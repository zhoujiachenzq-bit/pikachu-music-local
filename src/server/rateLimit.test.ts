import { describe, expect, it } from 'vitest';
import { createDatabase } from './db.js';
import { clearRateLimit, consumeRateLimits, positiveEnvInt } from './rateLimit.js';

describe('persistent rate limits', () => {
  it('checks multiple buckets atomically and reports a retry delay', () => {
    const db = createDatabase(':memory:'); const time = Date.parse('2026-08-14T00:00:00.000Z');
    const account = { scope: 'login:account', identifier: 'ash', limit: 2, windowMs: 60_000 };
    const ip = { scope: 'login:ip', identifier: '203.0.113.5', limit: 1, windowMs: 60_000 };
    expect(consumeRateLimits(db, [account, ip], time)).toMatchObject({ allowed: true, remaining: 0 });
    expect(consumeRateLimits(db, [account, ip], time + 1000)).toMatchObject({ allowed: false, scope: 'login:ip', retryAfterSeconds: 59 });
    clearRateLimit(db, ip);
    expect(consumeRateLimits(db, [account, ip], time + 2000)).toMatchObject({ allowed: true });
    expect(consumeRateLimits(db, [account], time + 3000)).toMatchObject({ allowed: false, scope: 'login:account' });
    expect(consumeRateLimits(db, [account], time + 61_000)).toMatchObject({ allowed: true });
    db.close();
  });

  it('falls back safely for invalid environment overrides', () => {
    process.env.TEST_SECURITY_LIMIT = '0'; expect(positiveEnvInt('TEST_SECURITY_LIMIT', 7)).toBe(7);
    process.env.TEST_SECURITY_LIMIT = '12'; expect(positiveEnvInt('TEST_SECURITY_LIMIT', 7)).toBe(12);
    delete process.env.TEST_SECURITY_LIMIT;
  });
});
