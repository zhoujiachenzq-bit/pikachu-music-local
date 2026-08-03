import type { Track, User } from '../shared/types';

export type PlayMode = User['playMode'];

function uniqueTracks(tracks: Track[]) {
  const seen = new Set<string>();
  return tracks.filter(track => Boolean(track.id) && !seen.has(track.id) && seen.add(track.id));
}

function shuffle<T>(values: T[], random: () => number) {
  const next = [...values];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [next[index], next[target]] = [next[target], next[index]];
  }
  return next;
}

export class PlaybackQueue {
  private tracks: Track[] = [];
  private currentId: string | null = null;
  private history: string[] = [];
  private historyIndex = -1;
  private shuffleRemaining: string[] = [];
  private lastMode: PlayMode | null = null;

  constructor(private readonly random: () => number = Math.random) {}

  reset(tracks: Track[], currentId: string) {
    this.tracks = uniqueTracks(tracks);
    if (!this.tracks.some(track => track.id === currentId)) {
      const current = tracks.find(track => track.id === currentId);
      if (current) this.tracks.unshift(current);
    }
    this.currentId = this.tracks.some(track => track.id === currentId) ? currentId : this.tracks[0]?.id || null;
    this.history = this.currentId ? [this.currentId] : [];
    this.historyIndex = this.history.length - 1;
    this.shuffleRemaining = this.buildShuffleCycle();
    this.lastMode = null;
  }

  get size() { return this.tracks.length; }
  get current() { return this.find(this.currentId); }
  snapshot() { return [...this.tracks]; }

  peek(direction: 1 | -1, mode: PlayMode) {
    if (!this.tracks.length) return null;
    this.prepareMode(mode);
    if (mode !== 'shuffle') return this.sequential(direction);
    if (direction === -1) return this.find(this.history[this.historyIndex - 1]) || this.current;
    const forward = this.find(this.history[this.historyIndex + 1]);
    if (forward) return forward;
    this.ensureShuffleCycle();
    return this.find(this.shuffleRemaining[0]) || this.current;
  }

  move(direction: 1 | -1, mode: PlayMode) {
    if (!this.tracks.length) return null;
    this.prepareMode(mode);
    if (mode !== 'shuffle') {
      const next = this.sequential(direction);
      if (next) this.record(next.id);
      return next;
    }

    if (direction === -1) {
      if (this.historyIndex > 0) this.historyIndex -= 1;
      this.currentId = this.history[this.historyIndex] || this.currentId;
      return this.current;
    }

    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex += 1;
      this.currentId = this.history[this.historyIndex];
      return this.current;
    }

    this.ensureShuffleCycle();
    const nextId = this.shuffleRemaining.shift() || this.currentId;
    if (!nextId) return null;
    if (nextId !== this.currentId || this.tracks.length > 1) this.record(nextId);
    return this.current;
  }

  drop(trackId: string) {
    this.tracks = this.tracks.filter(track => track.id !== trackId);
    this.shuffleRemaining = this.shuffleRemaining.filter(id => id !== trackId);
    this.history = this.history.filter(id => id !== trackId);
    this.historyIndex = Math.min(this.historyIndex, this.history.length - 1);
    if (this.currentId === trackId) this.currentId = this.history[this.historyIndex] || this.tracks[0]?.id || null;
  }

  private find(trackId: string | null | undefined) {
    return trackId ? this.tracks.find(track => track.id === trackId) || null : null;
  }

  private sequential(direction: 1 | -1) {
    if (!this.tracks.length) return null;
    const index = Math.max(0, this.tracks.findIndex(track => track.id === this.currentId));
    return this.tracks[(index + direction + this.tracks.length) % this.tracks.length] || null;
  }

  private buildShuffleCycle() {
    if (this.tracks.length <= 1) return this.tracks.map(track => track.id);
    return shuffle(this.tracks.map(track => track.id).filter(id => id !== this.currentId), this.random);
  }

  private ensureShuffleCycle() {
    if (!this.shuffleRemaining.length) this.shuffleRemaining = this.buildShuffleCycle();
  }

  private prepareMode(mode: PlayMode) {
    if (mode === 'shuffle' && this.lastMode !== 'shuffle') this.shuffleRemaining = this.buildShuffleCycle();
    this.lastMode = mode;
  }

  private record(trackId: string) {
    this.currentId = trackId;
    if (this.history[this.historyIndex] === trackId) return;
    this.history = this.history.slice(0, this.historyIndex + 1);
    this.history.push(trackId);
    this.historyIndex = this.history.length - 1;
  }
}
