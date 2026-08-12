import type { MusicSource } from '../shared/types';

export type ListeningContextType = 'search' | 'favorites' | 'playlist' | 'daily' | 'unknown';
export interface ListeningContext { type: ListeningContextType; id?: string | null }
export interface ListeningPayload {
  id: string; trackId: string; contextType: ListeningContextType; contextId: string | null; actualSource: MusicSource | null;
  startedAt: string; playedMs: number; durationMs: number; completed: boolean; skipped: boolean; errorCode: string | null;
}

interface ActiveListening extends ListeningPayload { lastMediaSeconds: number | null; lastSentMs: number }
type FinishReason = 'switch' | 'ended' | 'error' | 'pagehide';

export class ListeningTracker {
  private active: ActiveListening | null = null;
  constructor(
    private readonly send: (payload: ListeningPayload) => void,
    private readonly clock: () => number = () => Date.now(),
    private readonly createId: () => string = () => crypto.randomUUID()
  ) {}

  start(trackId: string, context: ListeningContext, actualSource: MusicSource | null, durationMs: number) {
    if (this.active) this.finish('switch');
    this.active = {
      id: this.createId(), trackId, contextType: context.type, contextId: context.id || null, actualSource,
      startedAt: new Date(this.clock()).toISOString(), playedMs: 0, durationMs: Math.max(0, Math.round(durationMs)),
      completed: false, skipped: false, errorCode: null, lastMediaSeconds: null, lastSentMs: 0
    };
  }

  play(mediaSeconds: number) { if (this.active) this.active.lastMediaSeconds = mediaSeconds; }

  tick(mediaSeconds: number, durationMs: number, playing: boolean) {
    const current = this.active; if (!current) return;
    if (durationMs > 0) current.durationMs = Math.max(current.durationMs, Math.round(durationMs));
    if (playing && current.lastMediaSeconds !== null) {
      const deltaMs = Math.round((mediaSeconds - current.lastMediaSeconds) * 1000);
      if (deltaMs > 0 && deltaMs <= 5000) current.playedMs += deltaMs;
    }
    current.lastMediaSeconds = mediaSeconds;
    if (current.playedMs - current.lastSentMs >= 15_000) this.flush();
  }

  pause(mediaSeconds: number, durationMs: number) { this.tick(mediaSeconds, durationMs, true); this.flush(); if (this.active) this.active.lastMediaSeconds = null; }
  setSource(source: MusicSource | null) { if (this.active) this.active.actualSource = source; }
  setError(code: string) { if (this.active) this.active.errorCode = code; }

  flush() {
    if (!this.active) return;
    this.send(this.snapshot(this.active)); this.active.lastSentMs = this.active.playedMs;
  }

  finish(reason: FinishReason) {
    const current = this.active; if (!current) return;
    const ratio = current.durationMs > 0 ? current.playedMs / current.durationMs : 0;
    current.completed = reason === 'ended' || ratio >= 0.8;
    current.skipped = !current.completed && ['switch', 'error'].includes(reason) && (current.playedMs < 30_000 || ratio < 0.2);
    if (reason === 'error' && !current.errorCode) current.errorCode = 'PLAYBACK_ERROR';
    this.send(this.snapshot(current)); this.active = null;
  }

  private snapshot(current: ActiveListening): ListeningPayload {
    const { lastMediaSeconds: _lastMediaSeconds, lastSentMs: _lastSentMs, ...payload } = current;
    return { ...payload };
  }
}
