import { createHash, randomBytes, randomUUID, scrypt as rawScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from './db.js';
import { rowToUser } from './db.js';
import type { User } from '../shared/types.js';

const scrypt = promisify(rawScrypt);
export const SESSION_COOKIE = 'pikachu_session';
export const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

export async function hashPassword(password: string, salt = randomBytes(16).toString('hex')) {
  const result = await scrypt(password, salt, 64) as Buffer;
  return { salt, hash: result.toString('hex') };
}

export async function verifyPassword(password: string, salt: string, expectedHex: string) {
  const actual = await scrypt(password, salt, 64) as Buffer;
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createSession(db: Db, userId: string) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const stamp = new Date().toISOString();
  db.prepare('INSERT INTO sessions(id,user_id,token_hash,expires_at,created_at) VALUES(?,?,?,?,?)')
    .run(randomUUID(), userId, tokenHash, new Date(Date.now() + SESSION_MS).toISOString(), stamp);
  return token;
}

function useSecureCookies() {
  return process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production';
}

export function setSessionCookie(reply: FastifyReply, token: string) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/', httpOnly: true, sameSite: 'strict', secure: useSecureCookies(), maxAge: SESSION_MS / 1000
  });
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'strict', secure: useSecureCookies() });
}

export function getSessionUser(db: Db, request: FastifyRequest): User | null {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return null;
  const hash = createHash('sha256').update(token).digest('hex');
  const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>?`).get(hash, new Date().toISOString()) as Record<string, unknown> | undefined;
  return row ? rowToUser(row) : null;
}

export function revokeToken(db: Db, token: string | undefined) {
  if (!token) return;
  const hash = createHash('sha256').update(token).digest('hex');
  db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash);
}

export function requireUser(db: Db, request: FastifyRequest, reply: FastifyReply): User | null {
  const user = getSessionUser(db, request);
  if (!user) {
    reply.code(401).send({ error: { code: 'AUTH_REQUIRED', message: '请先登录。' } });
    return null;
  }
  return user;
}

export function createUserId() { return randomUUID(); }
