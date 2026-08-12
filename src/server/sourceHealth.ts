import type { MusicSource } from '../shared/types.js';
import type { Db } from './db.js';

export type SourceOperation = 'search' | 'resolve' | 'playlist';

export interface SourceHealth {
  source: MusicSource;
  operation: SourceOperation;
  successes: number;
  failures: number;
  consecutiveFailures: number;
  averageLatencyMs: number;
  circuitOpenUntil: string | null;
  updatedAt: string;
}

export class SourceCircuitOpenError extends Error {
  readonly code = 'SOURCE_CIRCUIT_OPEN';
  constructor(public source: MusicSource, public retryAt: string) {
    super(`${source} 音乐源暂时不可用，将在 ${retryAt} 后重试。`);
  }
}

function isTrackLevelFailure(error: unknown) {
  const code = error && typeof error === 'object' && 'code' in error ? String((error as { code: unknown }).code) : '';
  return ['UNPLAYABLE', 'SOURCE_RESTRICTION_AUDIO', 'INVALID_MEDIA_RESPONSE', 'PLAYLIST_NOT_FOUND', 'FALLBACK_CONFIRM_REQUIRED'].includes(code);
}

function rowToHealth(row: Record<string, unknown>): SourceHealth {
  return {
    source: row.source as MusicSource,
    operation: row.operation as SourceOperation,
    successes: Number(row.successes || 0),
    failures: Number(row.failures || 0),
    consecutiveFailures: Number(row.consecutive_failures || 0),
    averageLatencyMs: Number(row.average_latency_ms || 0),
    circuitOpenUntil: row.circuit_open_until ? String(row.circuit_open_until) : null,
    updatedAt: String(row.updated_at)
  };
}

export function listSourceHealth(db: Db): SourceHealth[] {
  return (db.prepare('SELECT * FROM source_health ORDER BY source,operation').all() as Record<string, unknown>[]).map(rowToHealth);
}

export async function withSourceHealth<T>(
  db: Db | undefined,
  source: MusicSource,
  operation: SourceOperation,
  task: () => Promise<T>,
  clock = () => Date.now()
): Promise<T> {
  if (!db) return task();
  const before = db.prepare('SELECT * FROM source_health WHERE source=? AND operation=?').get(source, operation) as Record<string, unknown> | undefined;
  const currentTime = clock();
  if (before?.circuit_open_until && Date.parse(String(before.circuit_open_until)) > currentTime) {
    throw new SourceCircuitOpenError(source, String(before.circuit_open_until));
  }

  const startedAt = currentTime;
  try {
    const value = await task();
    const latency = Math.max(0, clock() - startedAt);
    const stamp = new Date(clock()).toISOString();
    db.prepare(`INSERT INTO source_health(source,operation,successes,failures,consecutive_failures,average_latency_ms,circuit_open_until,updated_at)
      VALUES(?,?,1,0,0,?,NULL,?) ON CONFLICT(source,operation) DO UPDATE SET
      successes=source_health.successes+1,consecutive_failures=0,
      average_latency_ms=ROUND((source_health.average_latency_ms*source_health.successes+excluded.average_latency_ms)/(source_health.successes+1)),
      circuit_open_until=NULL,updated_at=excluded.updated_at`).run(source, operation, latency, stamp);
    return value;
  } catch (error) {
    if (error instanceof SourceCircuitOpenError) throw error;
    if (isTrackLevelFailure(error)) throw error;
    const stamp = new Date(clock()).toISOString();
    db.prepare(`INSERT INTO source_health(source,operation,successes,failures,consecutive_failures,average_latency_ms,circuit_open_until,updated_at)
      VALUES(?,?,0,1,1,0,NULL,?) ON CONFLICT(source,operation) DO UPDATE SET
      failures=source_health.failures+1,consecutive_failures=source_health.consecutive_failures+1,
      updated_at=excluded.updated_at`).run(source, operation, stamp);
    const updated = db.prepare('SELECT consecutive_failures FROM source_health WHERE source=? AND operation=?').get(source, operation) as { consecutive_failures: number };
    const openMs = updated.consecutive_failures >= 6 ? 30 * 60_000 : updated.consecutive_failures >= 3 ? 10 * 60_000 : 0;
    if (openMs) db.prepare('UPDATE source_health SET circuit_open_until=? WHERE source=? AND operation=?').run(new Date(clock() + openMs).toISOString(), source, operation);
    throw error;
  }
}
