import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createDatabase, type Db } from './db.js';
import { createApp } from './app.js';
import { buildTrendPublishPayload, signKnowledgePublishPayload, TREND_REHEARSAL_FIXTURE } from './agentTrends.js';

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

  it('gives the admin a bounded usage ledger and one-time invitation codes', async () => {
    const previous = { admin: process.env.AGENT_ADMIN_USERNAMES, budget: process.env.AGENT_MONTHLY_BUDGET_CNY };
    process.env.AGENT_ADMIN_USERNAMES = 'masyu'; process.env.AGENT_MONTHLY_BUDGET_CNY = '10';
    try {
      db = createDatabase(':memory:'); app = await createApp({ db, logger: false }); await app.ready();
      const registered = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'masyu', password: 'Pikachu-2026' } });
      const cookie = registered.headers['set-cookie']!.split(';')[0]; const user = db.prepare('SELECT id FROM users WHERE username=?').get('masyu') as { id: string };
      const today = new Date().toISOString().slice(0, 10); const old = new Date(Date.now() - 60 * 24 * 60 * 60_000).toISOString().slice(0, 10);
      const insert = db.prepare('INSERT INTO agent_usage_daily(usage_date,user_id,provider,model,input_tokens,output_tokens,estimated_cost_cny) VALUES(?,?,?,?,?,?,?)');
      insert.run(today, user.id, 'deepseek', 'flash', 100, 20, 8.5); insert.run(old, user.id, 'deepseek', 'flash', 999, 999, 9);

      const usage = await app.inject({ method: 'GET', url: '/api/admin/agent/usage?days=7', headers: { cookie } });
      expect(usage.statusCode).toBe(200); expect(usage.json()).toMatchObject({ monthlyCostCny: 8.5, budgetCny: 10, state: 'flash_only', periodDays: 7, rows: [expect.objectContaining({ input_tokens: 100 })] });

      const created = await app.inject({ method: 'POST', url: '/api/admin/agent/invites', headers: { cookie }, payload: { maxUses: 2, expiresInDays: 14, note: 'preview' } });
      expect(created.statusCode).toBe(201); const invite = created.json().invite; expect(invite.code).toMatch(/^ZQ-[A-F\d]{12}$/);
      const listed = await app.inject({ method: 'GET', url: '/api/admin/agent/invites', headers: { cookie } });
      expect(listed.statusCode).toBe(200); expect(listed.json().invites[0]).toMatchObject({ id: invite.id, maxUses: 2, disabled: false, note: 'preview' }); expect(listed.body).not.toContain(invite.code);
      expect((await app.inject({ method: 'PATCH', url: `/api/admin/agent/invites/${invite.id}`, headers: { cookie }, payload: { disabled: true } })).statusCode).toBe(200);
      expect((await app.inject({ method: 'PATCH', url: '/api/admin/agent/invites/00000000-0000-4000-8000-000000000000', headers: { cookie }, payload: { disabled: true } })).statusCode).toBe(404);
    } finally {
      if (previous.admin === undefined) delete process.env.AGENT_ADMIN_USERNAMES; else process.env.AGENT_ADMIN_USERNAMES = previous.admin;
      if (previous.budget === undefined) delete process.env.AGENT_MONTHLY_BUDGET_CNY; else process.env.AGENT_MONTHLY_BUDGET_CNY = previous.budget;
    }
  });

  it('exposes version and retrieval health only to the configured agent admin', async () => {
    const previous = process.env.AGENT_ADMIN_USERNAMES; process.env.AGENT_ADMIN_USERNAMES = 'masyu';
    try {
      db = createDatabase(':memory:'); app = await createApp({ db, logger: false }); await app.ready();
      const admin = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'masyu', password: 'Pikachu-2026' } }); const adminCookie = admin.headers['set-cookie']!.split(';')[0];
      const result = await app.inject({ method: 'GET', url: '/api/admin/agent/knowledge?q=%E6%99%B4%E5%A4%A9', headers: { cookie: adminCookie } });
      expect(result.statusCode).toBe(200); expect(result.json()).toMatchObject({ embeddingConfigured: false, versions: expect.arrayContaining([expect.objectContaining({ source: 'bundled-curated-v2-300', itemCount: 300, embeddedCount: 0, embeddingRemaining: 300 })]), sample: expect.arrayContaining([expect.objectContaining({ title: '晴天', artist: '周杰伦' })]) });
      const ordinary = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'ordinary-user', password: 'Pikachu-2026' } }); const ordinaryCookie = ordinary.headers['set-cookie']!.split(';')[0];
      expect((await app.inject({ method: 'GET', url: '/api/admin/agent/knowledge', headers: { cookie: ordinaryCookie } })).statusCode).toBe(403);
    } finally { if (previous === undefined) delete process.env.AGENT_ADMIN_USERNAMES; else process.env.AGENT_ADMIN_USERNAMES = previous; }
  });

  it('rehearses and publishes trend knowledge without letting fixtures replace the active version', async () => {
    const previous = { admin: process.env.AGENT_ADMIN_USERNAMES, secret: process.env.KNOWLEDGE_PUBLISH_HMAC_KEY }; process.env.AGENT_ADMIN_USERNAMES = 'masyu'; process.env.KNOWLEDGE_PUBLISH_HMAC_KEY = 'integration-publish-secret';
    try {
      db = createDatabase(':memory:'); app = await createApp({ db, logger: false }); await app.ready();
      const registered = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'masyu', password: 'Pikachu-2026' } }); const cookie = registered.headers['set-cookie']!.split(';')[0];
      const rehearsal = await app.inject({ method: 'POST', url: '/api/admin/agent/trends/rehearse', headers: { cookie } });
      expect(rehearsal.statusCode).toBe(200); expect(rehearsal.json().rehearsal).toMatchObject({ itemCount: 5, duplicateCount: 1 });
      expect(db.prepare("SELECT id FROM knowledge_versions WHERE kind='douyin' AND status='active'").get()).toBeUndefined();

      const payload = buildTrendPublishPayload({ ...TREND_REHEARSAL_FIXTURE, provider: 'douyin' }); const signed = signKnowledgePublishPayload(payload, 'integration-publish-secret');
      const publish = await app.inject({ method: 'POST', url: '/api/admin/agent/knowledge/publish', headers: signed.headers, payload: signed.body });
      expect(publish.statusCode).toBe(201); expect(publish.json().version).toMatchObject({ kind: 'douyin', status: 'active', itemCount: 5 });
      const status = await app.inject({ method: 'GET', url: '/api/admin/agent/trends/status', headers: { cookie } });
      expect(status.statusCode).toBe(200); expect(status.json()).toMatchObject({ configuration: { publish: true, qishuiSnapshot: true }, activeVersion: { itemCount: 5 }, runs: expect.arrayContaining([expect.objectContaining({ mode: 'live', status: 'completed' })]) });
    } finally {
      if (previous.admin === undefined) delete process.env.AGENT_ADMIN_USERNAMES; else process.env.AGENT_ADMIN_USERNAMES = previous.admin;
      if (previous.secret === undefined) delete process.env.KNOWLEDGE_PUBLISH_HMAC_KEY; else process.env.KNOWLEDGE_PUBLISH_HMAC_KEY = previous.secret;
    }
  });
});
