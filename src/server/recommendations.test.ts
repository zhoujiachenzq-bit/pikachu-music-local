import { describe, expect, it } from 'vitest';
import { createDatabase, upsertTrack } from './db.js';
import { generateDailyRecommendation, listRecommendationHistory, mapWithConcurrency } from './recommendations.js';
import type { Track } from '../shared/types.js';

function makeTrack(sourceTrackId: string, title: string, artist: string, source: Track['source'] = 'qq'): Track {
  return { id: `${source}:${sourceTrackId}`, source, sourceTrackId, title, artist, album: '', duration: 180000, coverUrl: null, sourceUrl: null };
}

describe('daily recommendations', () => {
  it('limits concurrent discovery and playback probes', async () => {
    let active = 0; let peak = 0;
    const values = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async value => {
      active += 1; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 2)); active -= 1; return value * 2;
    });
    expect(values).toEqual([2, 4, 6, 8, 10, 12]); expect(peak).toBe(2);
  });

  it('mixes familiar and exploration tracks with canonical and artist limits', async () => {
    const db = createDatabase(':memory:'); const stamp = new Date().toISOString();
    db.prepare("INSERT INTO users(id,username,password_hash,password_salt,created_at,updated_at) VALUES('u','u','h','s',?,?)").run(stamp, stamp);
    for (let index = 0; index < 24; index += 1) {
      const saved = upsertTrack(db, makeTrack(`local-${index}`, `熟悉歌曲 ${index}`, `歌手 ${index}`));
      db.prepare('INSERT INTO favorites(user_id,track_id,created_at) VALUES(?,?,?)').run('u', saved.id, stamp);
    }
    const discoveries = Array.from({ length: 20 }, (_, index) => makeTrack(`new-${index}`, `探索歌曲 ${index}`, index < 4 ? '重复歌手' : `新歌手 ${index}`, 'kuwo'));
    discoveries.push({ ...discoveries[0], source: 'netease', sourceTrackId: 'same-other-source', id: 'netease:same-other-source' });
    const result = await generateDailyRecommendation(db, 'u', '2026-08-12', { discover: async () => discoveries, preflight: async () => true });
    expect(result.status).toBe('completed'); expect(result.tracks).toHaveLength(30);
    expect(result.tracks.filter(item => item.kind === 'familiar')).toHaveLength(21);
    expect(result.tracks.filter(item => item.kind === 'explore')).toHaveLength(9);
    expect(new Set(result.tracks.map(item => item.canonicalKey))).toHaveLength(30);
    expect(result.tracks.filter(item => item.artist === '重复歌手').length).toBeLessThanOrEqual(2);
    db.close();
  });

  it('excludes explicit negative feedback and keeps seven completed days', async () => {
    const db = createDatabase(':memory:'); const stamp = new Date().toISOString();
    db.prepare("INSERT INTO users(id,username,password_hash,password_salt,created_at,updated_at) VALUES('u','u','h','s',?,?)").run(stamp, stamp);
    const hidden = upsertTrack(db, makeTrack('hidden', '不要推荐', '某歌手'));
    db.prepare('INSERT INTO favorites(user_id,track_id,created_at) VALUES(?,?,?)').run('u', hidden.id, stamp);
    db.prepare("INSERT INTO recommendation_feedback(user_id,canonical_key,action,created_at,updated_at) VALUES(?,?,'not_interested',?,?)").run('u', hidden.canonicalKey, stamp, stamp);
    for (let day = 1; day <= 8; day += 1) {
      const date = `2026-08-${String(day).padStart(2, '0')}`;
      await generateDailyRecommendation(db, 'u', date, { discover: async () => [makeTrack(`d-${day}`, `每日 ${day}`, `歌手 ${day}`)], preflight: async () => true });
    }
    expect(listRecommendationHistory(db, 'u')).toHaveLength(7);
    expect(listRecommendationHistory(db, 'u').flatMap(item => item.tracks).some(item => item.id === hidden.id)).toBe(false);
    db.close();
  });

  it('hides feedback from an already-generated fixed daily list', async () => {
    const db = createDatabase(':memory:'); const stamp = new Date().toISOString();
    db.prepare("INSERT INTO users(id,username,password_hash,password_salt,created_at,updated_at) VALUES('u','u','h','s',?,?)").run(stamp, stamp);
    const visible = makeTrack('visible', '稍后隐藏', '歌手');
    await generateDailyRecommendation(db, 'u', '2026-08-12', { discover: async () => [visible], preflight: async () => true });
    const key = upsertTrack(db, visible).canonicalKey!;
    db.prepare("INSERT INTO recommendation_feedback(user_id,canonical_key,action,created_at,updated_at) VALUES(?,?,'not_interested',?,?)").run('u', key, stamp, stamp);
    expect(listRecommendationHistory(db, 'u')[0].tracks).toHaveLength(0);
    db.close();
  });

  it('excludes derivative editions and merges qualified titles into the plain original', async () => {
    const db = createDatabase(':memory:'); const stamp = new Date().toISOString();
    db.prepare("INSERT INTO users(id,username,password_hash,password_salt,created_at,updated_at) VALUES('u','u','h','s',?,?)").run(stamp, stamp);
    const original = makeTrack('original', '退后', '周杰伦', 'qq');
    const qualified = makeTrack('qualified', '退后（天空灰得像哭过）', '彦茹易', 'kuwo');
    const derivatives = [
      makeTrack('live', '退后 Live', '周杰伦', 'netease'),
      makeTrack('cover', '退后（翻唱）', '其他歌手', 'migu'),
      makeTrack('dj', '退后 DJ版', 'DJ 某某', 'kuwo')
    ];
    const result = await generateDailyRecommendation(db, 'u', '2026-08-18', {
      discover: async () => [qualified, ...derivatives, original], preflight: async () => true
    });
    expect(result.tracks.filter(track => track.title.startsWith('退后'))).toHaveLength(1);
    expect(result.tracks.find(track => track.title.startsWith('退后'))).toMatchObject({ title: '退后', artist: '周杰伦' });
    expect(result.tracks.some(track => /翻唱|live|dj版/i.test(track.title))).toBe(false);
    db.close();
  });
});
