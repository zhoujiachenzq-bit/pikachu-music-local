import { describe, expect, it } from 'vitest';
import { createDatabase, upsertTrack } from './db.js';
import {
  expectedIntentFromEvidence, runMusicIntentShadowGraph, saveMusicIntentAudit,
  shouldRunMusicIntentShadow, type ShadowModelResult
} from './agentReflectionGraph.js';

function model(intent: ShadowModelResult['intent'], confidence = .8): ShadowModelResult {
  return { intent, confidence, reasonCodes: ['MODEL_UNCERTAIN'], provider: 'fixture', model: 'fixture-model', inputTokens: 12, outputTokens: 4 };
}

function addUserAndRun(db: ReturnType<typeof createDatabase>) {
  const stamp = new Date().toISOString();
  db.prepare('INSERT INTO users(id,username,password_hash,password_salt,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('u', 'User', 'hash', 'salt', stamp, stamp);
  db.prepare('INSERT INTO agent_conversations(id,user_id,kind,status,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('c', 'u', 'main', 'active', stamp, stamp);
  db.prepare('INSERT INTO agent_runs(id,user_id,conversation_id,generation,status,model_tier,web_search,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run('r', 'u', 'c', 1, 'received', 'flash', 0, stamp, stamp);
}

describe('LangGraph music intent reflection shadow', () => {
  it('only audits colloquial playback subjects', () => {
    expect(shouldRunMusicIntentShadow('来首孙燕姿')).toBe(true);
    expect(shouldRunMusicIntentShadow('放一首孙燕姿的歌')).toBe(true);
    expect(shouldRunMusicIntentShadow('播放《我不难过》')).toBe(false);
    expect(shouldRunMusicIntentShadow('今天心情不太好')).toBe(false);
  });

  it('uses exact site evidence to revise a model that treats an artist as a title', async () => {
    const db = createDatabase(':memory:');
    upsertTrack(db, { id: 'qq:x', source: 'qq', sourceTrackId: 'x', title: '我不难过', artist: '孙燕姿', album: '', duration: 320000, coverUrl: null, sourceUrl: null });
    const result = await runMusicIntentShadowGraph(db, { message: '来首孙燕姿', legacyIntent: 'play_artist' }, async () => model('play_song', .92));
    expect(result).toMatchObject({ proposedIntent: 'play_song', finalIntent: 'play_artist', verdict: 'revise', confidence: .98 });
    expect(result.reasonCodes).toContain('EXACT_ARTIST_EVIDENCE_OVERRULED_MODEL');
    db.close();
  });

  it('passes a title interpretation that agrees with exact evidence', async () => {
    const db = createDatabase(':memory:');
    upsertTrack(db, { id: 'qq:y', source: 'qq', sourceTrackId: 'y', title: '退后', artist: '周杰伦', album: '', duration: 261000, coverUrl: null, sourceUrl: null });
    const result = await runMusicIntentShadowGraph(db, { message: '来首退后', legacyIntent: 'play_song' }, async () => model('play_song', .91));
    expect(result).toMatchObject({ finalIntent: 'play_song', verdict: 'pass', confidence: .91 });
    db.close();
  });

  it('asks the user when a term is both an artist and a song title', async () => {
    const db = createDatabase(':memory:');
    upsertTrack(db, { id: 'qq:a', source: 'qq', sourceTrackId: 'a', title: '遇见', artist: '孙燕姿', album: '', duration: 210000, coverUrl: null, sourceUrl: null });
    upsertTrack(db, { id: 'qq:b', source: 'qq', sourceTrackId: 'b', title: '孙燕姿', artist: '测试歌手', album: '', duration: 180000, coverUrl: null, sourceUrl: null });
    const result = await runMusicIntentShadowGraph(db, { message: '来首孙燕姿', legacyIntent: 'ambiguous' }, async () => model('play_artist', .99));
    expect(result).toMatchObject({ finalIntent: 'ambiguous', verdict: 'ask_user' });
    expect(result.reasonCodes).toContain('ARTIST_TITLE_COLLISION');
    db.close();
  });

  it('does not trust an unsupported model guess and stores no plaintext subject in the audit', async () => {
    const db = createDatabase(':memory:'); addUserAndRun(db);
    const result = await runMusicIntentShadowGraph(db, { message: '来首完全未知名字', legacyIntent: 'ambiguous' }, async () => model('play_artist', .95));
    expect(result).toMatchObject({ finalIntent: 'ambiguous', verdict: 'ask_user' });
    saveMusicIntentAudit(db, { runId: 'r', userId: 'u', result });
    const row = db.prepare('SELECT subject_hash,evidence_json FROM agent_inference_audits WHERE run_id=?').get('r') as { subject_hash: string; evidence_json: string };
    expect(row.subject_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.subject_hash).not.toContain('完全未知名字');
    expect(JSON.parse(row.evidence_json)).toMatchObject({ exactArtist: false, exactTitle: false });
    db.close();
  });

  it('keeps explicit artist syntax deterministic even without local identity evidence', () => {
    expect(expectedIntentFromEvidence({ exactArtist: false, exactTitle: false, artistTrackCount: 0, titleTrackCount: 0, explicitArtistSyntax: true })).toBe('play_artist');
  });
});
