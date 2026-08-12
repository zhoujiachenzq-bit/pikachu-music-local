import { describe, expect, it } from 'vitest';
import { ListeningTracker, type ListeningPayload } from './listeningTracker';

describe('local listening behavior tracker', () => {
  it('counts actual playback but ignores seek jumps', () => {
    const sent: ListeningPayload[] = []; const tracker = new ListeningTracker(value => sent.push(value), () => 0, () => 'session-1');
    tracker.start('qq:1', { type: 'favorites' }, 'qq', 100_000); tracker.play(0);
    tracker.tick(1, 100_000, true); tracker.tick(40, 100_000, true); tracker.tick(41, 100_000, true); tracker.finish('switch');
    expect(sent.at(-1)).toMatchObject({ playedMs: 2000, skipped: true, completed: false, contextType: 'favorites' });
  });

  it('marks eighty percent listening as completed instead of skipped', () => {
    const sent: ListeningPayload[] = []; const tracker = new ListeningTracker(value => sent.push(value), () => 0, () => 'session-2');
    tracker.start('qq:2', { type: 'playlist', id: 'p' }, 'qq', 10_000); tracker.play(0);
    for (let second = 1; second <= 8; second += 1) tracker.tick(second, 10_000, true);
    tracker.finish('switch');
    expect(sent.at(-1)).toMatchObject({ playedMs: 8000, completed: true, skipped: false, contextId: 'p' });
  });
});
