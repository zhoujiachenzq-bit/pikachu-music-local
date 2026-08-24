import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createDatabase, type Db } from './db.js';
import { createApp } from './app.js';

describe('agent API', () => {
  let db: Db | undefined; let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); if (db) db.close(); app = undefined; db = undefined; });

  it('requires an invite for accounts created after the agent migration', async () => {
    db = createDatabase(':memory:'); app = await createApp({ db, logger: false }); await app.ready();
    const registered = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'NewAgentUser', password: 'Pikachu-2026' } }); const cookie = registered.headers['set-cookie']!.split(';')[0];
    const access = await app.inject({ method: 'GET', url: '/api/agent/access', headers: { cookie } });
    expect(access.statusCode).toBe(200); expect(access.json().access).toMatchObject({ entitled: false, configured: true });
    expect((await app.inject({ method: 'GET', url: '/api/agent/conversations/main', headers: { cookie } })).statusCode).toBe(403);
  });

  it('streams a deterministic action for an entitled account without model configuration', async () => {
    db = createDatabase(':memory:'); app = await createApp({ db, logger: false }); await app.ready();
    const registered = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'ExistingAgent', password: 'Pikachu-2026' } }); const cookie = registered.headers['set-cookie']!.split(';')[0];
    const user = db.prepare('SELECT id FROM users WHERE username=?').get('ExistingAgent') as { id: string }; db.prepare("INSERT INTO agent_entitlements(user_id,source,granted_at) VALUES(?,'invite',?)").run(user.id, new Date().toISOString());
    const conversation = (await app.inject({ method: 'GET', url: '/api/agent/conversations/main', headers: { cookie } })).json().conversation;
    const response = await app.inject({ method: 'POST', url: '/api/agent/messages', headers: { cookie }, payload: { conversationId: conversation.id, message: '暂停', generation: 1, webSearch: false, context: { currentTrack: null, queue: [], playing: false, currentTime: 0, volume: .8, playMode: 'list' } } });
    expect(response.statusCode).toBe(200); expect(response.headers['content-type']).toContain('text/event-stream'); expect(response.body).toContain('"type":"client_action"'); expect(response.body).toContain('"type":"pause"');
    expect(response.body).toContain('"type":"done"');
  });

  it('shows the admin a secret-free model provider status', async () => {
    const previous = {
      admin: process.env.AGENT_ADMIN_USERNAMES,
      selected: process.env.AGENT_MODEL_PROVIDER,
      deepseek: process.env.DEEPSEEK_API_KEY
    };
    process.env.AGENT_ADMIN_USERNAMES = 'masyu';
    process.env.AGENT_MODEL_PROVIDER = 'deepseek';
    process.env.DEEPSEEK_API_KEY = 'server-secret-must-not-leak';
    try {
      db = createDatabase(':memory:'); app = await createApp({ db, logger: false }); await app.ready();
      const registered = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'masyu', password: 'Pikachu-2026' } });
      const cookie = registered.headers['set-cookie']!.split(';')[0];
      const response = await app.inject({ method: 'GET', url: '/api/admin/agent/providers', headers: { cookie } });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ selectionMode: 'deepseek', providers: expect.arrayContaining([expect.objectContaining({ id: 'deepseek', configured: true, selected: true })]) });
      expect(response.body).not.toContain('server-secret-must-not-leak');
    } finally {
      if (previous.admin === undefined) delete process.env.AGENT_ADMIN_USERNAMES; else process.env.AGENT_ADMIN_USERNAMES = previous.admin;
      if (previous.selected === undefined) delete process.env.AGENT_MODEL_PROVIDER; else process.env.AGENT_MODEL_PROVIDER = previous.selected;
      if (previous.deepseek === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = previous.deepseek;
    }
  });
});
