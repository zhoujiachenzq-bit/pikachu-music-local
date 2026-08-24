import { describe, expect, it } from 'vitest';
import { createDatabase, upsertTrack } from './db.js';
import { loadAgentKeyring } from './agentCrypto.js';
import { createAgentInvite, createAgentMemory, createAgentRun, createToolAction, ensureMainConversation, listAgentMemories, nextAgentProactivePrompt, redeemAgentInvite, saveAgentMessage, updateToolAction } from './agentStore.js';

function addUser(db: ReturnType<typeof createDatabase>, id: string, username: string) {
  const stamp = new Date().toISOString(); db.prepare('INSERT INTO users(id,username,password_hash,password_salt,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id, username, 'hash', 'salt', stamp, stamp);
}

describe('agent data isolation and action ledger', () => {
  it('isolates encrypted messages and memories by account', () => {
    const db = createDatabase(':memory:'); addUser(db, 'a', 'Ash'); addUser(db, 'b', 'Misty'); const keyring = loadAgentKeyring({} as NodeJS.ProcessEnv);
    const conversation = ensureMainConversation(db, 'a'); saveAgentMessage(db, keyring, 'a', conversation.id, 'user', '我喜欢民谣');
    createAgentMemory(db, keyring, 'a', { category: 'preference', content: '喜欢民谣', confidence: 1, inferred: false });
    expect(listAgentMemories(db, keyring, 'a').map(item => item.content)).toEqual(['喜欢民谣']); expect(listAgentMemories(db, keyring, 'b')).toEqual([]);
    const raw = db.prepare('SELECT content_ciphertext FROM agent_messages WHERE user_id=?').get('a') as { content_ciphertext: string };
    expect(raw.content_ciphertext).not.toContain('我喜欢民谣'); db.close();
  });

  it('hashes invite codes and rejects reusing a completed action', () => {
    const db = createDatabase(':memory:'); addUser(db, 'admin', 'Admin'); addUser(db, 'a', 'Ash');
    const invite = createAgentInvite(db, 'admin', { maxUses: 1, expiresInDays: 30, note: 'test' });
    expect(JSON.stringify(db.prepare('SELECT * FROM agent_invites').get())).not.toContain(invite.code);
    expect(redeemAgentInvite(db, 'a', invite.code)).toBe(true); expect(redeemAgentInvite(db, 'a', invite.code)).toBe(false);
    const conversation = ensureMainConversation(db, 'a'); const run = createAgentRun(db, 'a', conversation.id, 1, 'local', false); const action = createToolAction(db, run, 'a', 'control_player', 'direct', { action: 'pause' });
    expect(updateToolAction(db, 'a', action.id, 'executed', { ok: true }, ['proposed'])?.status).toBe('executed');
    expect(updateToolAction(db, 'a', action.id, 'executed', { ok: true }, ['proposed'])).toBeNull(); db.close();
  });

  it('limits proactive companionship to the cooldown window', () => {
    const db = createDatabase(':memory:'); addUser(db, 'a', 'Ash'); const track = upsertTrack(db, { id: 'qq:old', source: 'qq', sourceTrackId: 'old', title: '旧日旋律', artist: '原唱', album: '', duration: 180000, coverUrl: null, sourceUrl: null });
    const old = new Date('2026-07-01T00:00:00.000Z').toISOString(); db.prepare(`INSERT INTO listening_sessions(id,user_id,track_id,context_type,started_at,updated_at,played_ms,duration_ms) VALUES(?,?,?,'search',?,?,?,?)`).run('listen-old', 'a', track.id, old, old, 90000, 180000);
    const first = nextAgentProactivePrompt(db, 'a', new Date('2026-08-24T08:00:00.000Z')); expect(first?.kind).toBe('reunion');
    expect(nextAgentProactivePrompt(db, 'a', new Date('2026-08-24T09:00:00.000Z'))).toBeNull(); db.close();
  });
});
