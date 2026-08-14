import { createHash } from 'node:crypto';
import type { FastifyReply } from 'fastify';
import type { Db } from './db.js';
import { transaction } from './db.js';

export interface RateLimitRule {
  scope: string;
  identifier: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: string;
  retryAfterSeconds: number;
  scope: string;
}

let cleanupCounter = 0;

function bucketKey(rule: Pick<RateLimitRule, 'scope' | 'identifier'>): string {
  return createHash('sha256').update(`${rule.scope}\0${rule.identifier}`).digest('hex');
}

function activeRow(db: Db, key: string, time: number) {
  const row = db.prepare('SELECT count,reset_at FROM rate_limits WHERE bucket_key=?').get(key) as { count: number; reset_at: string } | undefined;
  return row && Date.parse(row.reset_at) > time ? row : undefined;
}

export function consumeRateLimits(db: Db, rules: RateLimitRule[], time = Date.now()): RateLimitResult {
  if (!rules.length) throw new Error('At least one rate-limit rule is required.');
  cleanupCounter += 1;
  if (cleanupCounter % 256 === 0) db.prepare('DELETE FROM rate_limits WHERE reset_at<=?').run(new Date(time).toISOString());
  return transaction(db, () => {
    for (const rule of rules) {
      const row = activeRow(db, bucketKey(rule), time);
      if (row && row.count >= rule.limit) {
        const retryAfterSeconds = Math.max(1, Math.ceil((Date.parse(row.reset_at) - time) / 1000));
        return { allowed: false, limit: rule.limit, remaining: 0, resetAt: row.reset_at, retryAfterSeconds, scope: rule.scope };
      }
    }

    const stamp = new Date(time).toISOString();
    let tightest: RateLimitResult | null = null;
    for (const rule of rules) {
      const key = bucketKey(rule); const row = activeRow(db, key, time);
      const count = (row?.count || 0) + 1;
      const resetAt = row?.reset_at || new Date(time + rule.windowMs).toISOString();
      db.prepare(`INSERT INTO rate_limits(bucket_key,count,reset_at,updated_at) VALUES(?,?,?,?)
        ON CONFLICT(bucket_key) DO UPDATE SET count=excluded.count,reset_at=excluded.reset_at,updated_at=excluded.updated_at`)
        .run(key, count, resetAt, stamp);
      const result = {
        allowed: true, limit: rule.limit, remaining: Math.max(0, rule.limit - count), resetAt,
        retryAfterSeconds: Math.max(1, Math.ceil((Date.parse(resetAt) - time) / 1000)), scope: rule.scope
      };
      if (!tightest || result.remaining / result.limit < tightest.remaining / tightest.limit) tightest = result;
    }
    return tightest!;
  });
}

export function clearRateLimit(db: Db, rule: Pick<RateLimitRule, 'scope' | 'identifier'>): void {
  db.prepare('DELETE FROM rate_limits WHERE bucket_key=?').run(bucketKey(rule));
}

export function applyRateLimitHeaders(reply: FastifyReply, result: RateLimitResult): void {
  reply.header('ratelimit-limit', String(result.limit));
  reply.header('ratelimit-remaining', String(result.remaining));
  reply.header('ratelimit-reset', String(result.retryAfterSeconds));
  if (!result.allowed) reply.header('retry-after', String(result.retryAfterSeconds));
}

export function positiveEnvInt(name: string, fallback: number, minimum = 1, maximum = 1_000_000): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}
