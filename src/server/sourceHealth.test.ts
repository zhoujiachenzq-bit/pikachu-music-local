import { describe, expect, it } from 'vitest';
import { createDatabase } from './db.js';
import { listSourceHealth, SourceCircuitOpenError, withSourceHealth } from './sourceHealth.js';

describe('source health circuit breaker', () => {
  it('opens after three consecutive failures and resets after a successful probe', async () => {
    const db = createDatabase(':memory:'); let time = Date.parse('2026-08-12T00:00:00.000Z');
    for (let count = 0; count < 3; count += 1) {
      await expect(withSourceHealth(db, 'kuwo', 'search', async () => { throw new Error('offline'); }, () => time)).rejects.toThrow('offline');
      time += 10;
    }
    await expect(withSourceHealth(db, 'kuwo', 'search', async () => [], () => time)).rejects.toBeInstanceOf(SourceCircuitOpenError);
    time += 10 * 60_000 + 1;
    await expect(withSourceHealth(db, 'kuwo', 'search', async () => ['ok'], () => time)).resolves.toEqual(['ok']);
    expect(listSourceHealth(db)[0]).toMatchObject({ consecutiveFailures: 0, successes: 1, failures: 3, circuitOpenUntil: null });
    db.close();
  });
});
