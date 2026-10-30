import { describe, expect, it } from 'vitest';
import { createDatabase, rowToTrack, upsertTrack } from './db.js';
import type { Track } from '../shared/types.js';

describe('track metadata persistence', () => {
  it('does not let an old client erase known duration or album metadata', () => {
    const db = createDatabase(':memory:');
    const track: Track = {
      id: 'qq:one', source: 'qq', sourceTrackId: 'one', title: '退后', artist: '周杰伦', album: '依然范特西',
      duration: 261_000, coverUrl: 'https://example.test/cover.jpg', sourceUrl: null
    };
    upsertTrack(db, track);
    upsertTrack(db, { ...track, album: '', duration: 0, coverUrl: null });
    const saved = rowToTrack(db.prepare('SELECT * FROM tracks WHERE id=?').get(track.id) as Record<string, unknown>);
    expect(saved).toMatchObject({ album: '依然范特西', duration: 261_000, coverUrl: 'https://example.test/cover.jpg' });
    db.close();
  });

  it('stops creating agent tables but leaves existing ones and their rows alone', () => {
    const db = createDatabase(':memory:');
    try {
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'agent_%'").all()).toEqual([]);
      db.exec("CREATE TABLE agent_messages(id TEXT PRIMARY KEY, created_at TEXT); INSERT INTO agent_messages VALUES('old','2020-01-01T00:00:00.000Z')");
      expect(db.prepare('SELECT COUNT(*) total FROM agent_messages').get()).toMatchObject({ total: 1 });
    } finally { db.close(); }
  });
});
