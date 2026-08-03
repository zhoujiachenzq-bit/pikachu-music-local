import { describe, expect, it } from 'vitest';
import type { Track } from '../shared/types';
import { PlaybackQueue } from './playerQueue';

const track = (id: string): Track => ({
  id, source: 'qq', sourceTrackId: id, title: id, artist: '', album: '', duration: 0, coverUrl: null, sourceUrl: null,
});

describe('PlaybackQueue', () => {
  it('wraps list navigation in both directions', () => {
    const queue = new PlaybackQueue(); queue.reset(['a', 'b', 'c'].map(track), 'c');
    expect(queue.move(1, 'list')?.id).toBe('a');
    expect(queue.move(-1, 'list')?.id).toBe('c');
  });

  it('uses sequential manual navigation while repeat-one is handled natively', () => {
    const queue = new PlaybackQueue(); queue.reset(['a', 'b'].map(track), 'a');
    expect(queue.move(1, 'loop')?.id).toBe('b');
    expect(queue.move(-1, 'loop')?.id).toBe('a');
  });

  it('plays a complete shuffle cycle without repeats and follows history backwards', () => {
    const queue = new PlaybackQueue(() => 0); queue.reset(['a', 'b', 'c', 'd'].map(track), 'a');
    const cycle = [queue.move(1, 'shuffle')?.id, queue.move(1, 'shuffle')?.id, queue.move(1, 'shuffle')?.id];
    expect(new Set(cycle)).toEqual(new Set(['b', 'c', 'd']));
    const last = cycle[2]; const previous = cycle[1];
    expect(queue.move(-1, 'shuffle')?.id).toBe(previous);
    expect(queue.move(1, 'shuffle')?.id).toBe(last);
  });

  it('rebuilds the shuffle bag when switching from sequential playback', () => {
    const queue = new PlaybackQueue(() => 0); queue.reset(['a', 'b', 'c'].map(track), 'a');
    expect(queue.move(1, 'list')?.id).toBe('b');
    const shuffled = [queue.move(1, 'shuffle')?.id, queue.move(1, 'shuffle')?.id];
    expect(shuffled).not.toContain('b');
    expect(new Set(shuffled)).toEqual(new Set(['a', 'c']));
  });

  it('handles a one-track queue without growing invalid state', () => {
    const queue = new PlaybackQueue(); queue.reset([track('only')], 'only');
    expect(queue.move(1, 'shuffle')?.id).toBe('only');
    expect(queue.move(-1, 'list')?.id).toBe('only');
  });

  it('keeps the original snapshot and can drop an unplayable item', () => {
    const source = ['a', 'b', 'c'].map(track); const queue = new PlaybackQueue(); queue.reset(source, 'a');
    source.splice(1, 2, track('outside'));
    expect(queue.snapshot().map(item => item.id)).toEqual(['a', 'b', 'c']);
    queue.drop('b');
    expect(queue.move(1, 'list')?.id).toBe('c');
  });
});
