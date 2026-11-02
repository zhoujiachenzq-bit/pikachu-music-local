import { describe, expect, it, vi } from 'vitest';
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
    expect(result.tracks.slice(0, 10).filter(item => item.kind === 'explore')).toHaveLength(3);
    expect(result.tracks.some((track, index) => index > 0 && track.artist === result.tracks[index - 1].artist)).toBe(false);
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

describe('local recommendation quality', () => {
  function setup() {
    const db = createDatabase(':memory:');
    for (const user of ['u', 'other']) db.prepare("INSERT INTO users(id,username,password_hash,password_salt,created_at,updated_at) VALUES(?,?,'h','s','2026-01-01','2026-01-01')").run(user, user);
    return db;
  }
  function favorite(db: ReturnType<typeof createDatabase>, track: Track, user = 'u') {
    const saved = upsertTrack(db, track);
    db.prepare('INSERT INTO favorites(user_id,track_id,created_at) VALUES(?,?,?)').run(user, saved.id, '2026-01-01');
    return saved;
  }
  function listen(db: ReturnType<typeof createDatabase>, track: Track, options: { date: string; played?: number; completed?: boolean; skipped?: boolean; error?: string; count?: number; user?: string }) {
    const saved = upsertTrack(db, track);
    for (let i = 0; i < (options.count || 1); i++) db.prepare(`INSERT INTO listening_sessions(id,user_id,track_id,context_type,started_at,updated_at,played_ms,duration_ms,completed,skipped,error_code)
      VALUES(?,?,?,'unknown',?,?,?,180000,?,?,?)`).run(`${saved.id}-${options.date}-${i}`, options.user || 'u', saved.id, options.date, options.date, options.played ?? 180000, options.completed ? 1 : 0, options.skipped ? 1 : 0, options.error || null);
  }

  it('learns from recent completed listening even while keeping that song out of repeats, without another account influencing it', async () => {
    const db = setup();
    try {
      const heard = makeTrack('heard', '刚听完', '近期歌手');
      listen(db, heard, { date: '2026-08-11T10:00:00.000Z', completed: true });
      for (let i = 0; i < 10; i++) favorite(db, makeTrack(`other-${i}`, `他人收藏 ${i}`, '他人的歌手'), 'other');
      const fresh = makeTrack('fresh', '另一首原作', '近期歌手');
      const queries: string[] = [];
      const result = await generateDailyRecommendation(db, 'u', '2026-08-12', { discover: async q => { queries.push(q); return [heard, fresh, ...Array.from({length:35}, (_, i) => makeTrack(`random-${i}`, `探索 ${i}`, `其他歌手 ${i}`))]; }, preflight: async () => true });
      expect(queries).toContain('近期歌手'); expect(queries).not.toContain('他人的歌手'); expect(queries).toHaveLength(2);
      expect(result.tracks.some(track => track.id === heard.id)).toBe(false);
      expect(result.tracks[0]).toMatchObject({ id: fresh.id, reason: '根据你的歌手偏好' });
    } finally { db.close(); }
  });

  it('gives recent listening more weight than equally frequent old listening', async () => {
    const db = setup();
    try {
      const recent = favorite(db, makeTrack('recent', '近期偏好', '甲'));
      const old = favorite(db, makeTrack('old', '过去偏好', '乙'));
      listen(db, recent, { date: '2026-08-01T10:00:00.000Z', completed: true, count: 10 });
      listen(db, old, { date: '2026-01-01T10:00:00.000Z', completed: true, count: 10 });
      const result = await generateDailyRecommendation(db, 'u', '2026-08-12', { discover: async () => [], preflight: async () => true });
      expect(result.tracks[0].id).toBe(recent.id);
      expect(result.tracks[0].score).toBeGreaterThan(result.tracks[1].score + 15);
    } finally { db.close(); }
  });

  it('downranks early skips while treating playback errors and late skips separately', async () => {
    const db = setup();
    try {
      const early = favorite(db, makeTrack('early', '多次早跳', '甲'));
      const late = favorite(db, makeTrack('late', '听到结尾', '乙'));
      const error = favorite(db, makeTrack('error', '播放故障', '丙'));
      for (const [track, played, failure] of [[early, 1000, undefined], [late, 170000, undefined], [error, 0, 'NETWORK_ERROR']] as const)
        listen(db, track, { date: '2026-08-11T10:00:00.000Z', played, error: failure, skipped: true, count: 4 });
      const result = await generateDailyRecommendation(db, 'u', '2026-08-12', { discover: async () => [], preflight: async () => true });
      expect(result.tracks.at(-1)?.id).toBe(early.id);
      expect(result.tracks.find(track => track.id === error.id)!.score).toBeGreaterThan(40);
    } finally { db.close(); }
  });

  it('rotates yesterday’s unplayed recommendations behind unseen candidates', async () => {
    const db = setup();
    try {
      for (let i = 0; i < 45; i++) favorite(db, makeTrack(`rotation-${i}`, `轮换歌曲 ${i}`, `歌手 ${i}`));
      const deps = { discover: async () => [], preflight: async () => true };
      const previous = await generateDailyRecommendation(db, 'u', '2026-08-11', deps);
      const seen = new Set(previous.tracks.map(track => track.id));
      const next = await generateDailyRecommendation(db, 'u', '2026-08-12', deps);
      expect(next.tracks.slice(0, 15).every(track => !seen.has(track.id))).toBe(true);
      expect(next.tracks).toHaveLength(30);
    } finally { db.close(); }
  });

  it('probes each failing candidate only once across refill passes', async () => {
    const db = setup();
    try {
      const track = favorite(db, makeTrack('unplayable', '失败候选', '歌手'));
      const probe = vi.fn(async () => false);
      const result = await generateDailyRecommendation(db, 'u', '2026-08-12', { discover: async () => [track], preflight: probe });
      expect(result.tracks).toHaveLength(0); expect(probe).toHaveBeenCalledOnce();
    } finally { db.close(); }
  });

  it('applies artist feedback immediately to stored recommendations for the correct account', async () => {
    const db = setup();
    try {
      const track = makeTrack('artist-feedback', '原作', 'Artist A');
      const deps = { discover: async () => [track], preflight: async () => true };
      await generateDailyRecommendation(db, 'u', '2026-08-12', deps);
      await generateDailyRecommendation(db, 'other', '2026-08-12', deps);
      db.prepare("INSERT INTO recommendation_feedback(user_id,canonical_key,action,artist_key,created_at,updated_at) VALUES('u',?,'less_artist','artista','2026-08-12','2026-08-12')").run(track.id);
      expect(listRecommendationHistory(db, 'u')[0].tracks).toHaveLength(0);
      expect(listRecommendationHistory(db, 'other')[0].tracks).toHaveLength(1);
    } finally { db.close(); }
  });
});
