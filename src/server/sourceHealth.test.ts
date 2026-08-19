import { describe, expect, it } from 'vitest';
import { createDatabase } from './db.js';
import { listSourceHealth, resetSourceHealthCircuits, SourceCircuitOpenError, withSourceHealth } from './sourceHealth.js';

describe('source health circuit breaker', () => {
  it('opens after three consecutive failures and resets after a successful probe', async () => {
    const db = createDatabase(':memory:'); let time = Date.parse('2026-08-12T00:00:00.000Z');
    for (let count = 0; count < 3; count += 1) {
      await expect(withSourceHealth(db, 'kuwo', 'search', async () => { throw new Error('offline'); }, () => time)).rejects.toThrow('offline');
      time += 10;
    }
    await expect(withSourceHealth(db, 'kuwo', 'search', async () => [], () => time)).rejects.toBeInstanceOf(SourceCircuitOpenError);
    time += 30_000 + 1;
    await expect(withSourceHealth(db, 'kuwo', 'search', async () => ['ok'], () => time)).resolves.toEqual(['ok']);
    expect(listSourceHealth(db)[0]).toMatchObject({ consecutiveFailures: 0, successes: 1, failures: 3, circuitOpenUntil: null });
    db.close();
  });

  it('clears persisted circuit state when the local service restarts', async () => {
    const db = createDatabase(':memory:'); const time = Date.parse('2026-08-12T00:00:00.000Z');
    for (let count = 0; count < 3; count += 1) {
      await expect(withSourceHealth(db, 'netease', 'resolve', async () => { throw new Error('proxy offline'); }, () => time + count)).rejects.toThrow('proxy offline');
    }
    expect(listSourceHealth(db)[0]).toMatchObject({ consecutiveFailures: 3, circuitOpenUntil: new Date(time + 2 + 30_000).toISOString() });
    expect(resetSourceHealthCircuits(db)).toBe(1);
    expect(listSourceHealth(db)[0]).toMatchObject({ consecutiveFailures: 0, circuitOpenUntil: null, failures: 3 });
    db.close();
  });
});
