import { randomBytes } from 'node:crypto';
import type { MusicSource, ResolvedTrack } from '../shared/types.js';

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface MediaTicket {
  token: string;
  userId: string;
  source: MusicSource;
  url: string;
  expiresAt: number;
}

const SOURCE_MEDIA_HOSTS: Record<MusicSource, string[]> = {
  migu: ['migu.cn', 'migumusic.com'],
  netease: ['music.126.net', 'music.163.com', '126.net'],
  qq: ['qqmusic.qq.com', 'y.qq.com', 'gtimg.cn'],
  kuwo: ['kuwo.cn']
};

function allowedMediaUrl(value: string, source: MusicSource): string | null {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (!SOURCE_MEDIA_HOSTS[source].some(allowed => host === allowed || host.endsWith(`.${allowed}`))) return null;
    return url.toString();
  } catch { return null; }
}

export class MediaTicketStore {
  private tickets = new Map<string, MediaTicket>();

  constructor(private clock: () => number = Date.now, private ttlMs = 20 * 60_000, private limit = 1000) {}

  issue(userId: string, track: ResolvedTrack): string | null {
    if (track.audioUrl.startsWith('/api/backup-media?')) return track.audioUrl;
    const url = allowedMediaUrl(track.audioUrl, track.actualSource); if (!url) return null;
    this.cleanup(); const token = randomBytes(24).toString('base64url');
    this.tickets.set(token, { token, userId, source: track.actualSource, url, expiresAt: this.clock() + this.ttlMs });
    if (this.tickets.size > this.limit) {
      const oldest = [...this.tickets.values()].sort((a, b) => a.expiresAt - b.expiresAt).slice(0, this.tickets.size - this.limit);
      oldest.forEach(ticket => this.tickets.delete(ticket.token));
    }
    return `/api/media/${token}`;
  }

  get(token: string, userId: string): MediaTicket | null {
    const ticket = this.tickets.get(token);
    if (!ticket || ticket.userId !== userId || ticket.expiresAt <= this.clock()) {
      if (ticket?.expiresAt && ticket.expiresAt <= this.clock()) this.tickets.delete(token);
      return null;
    }
    return ticket;
  }

  private cleanup() {
    const now = this.clock();
    for (const [token, ticket] of this.tickets) if (ticket.expiresAt <= now) this.tickets.delete(token);
  }
}

export function safeRangeHeader(value: string | undefined): string | undefined {
  return value && /^bytes=\d*-\d*$/.test(value.trim()) ? value.trim() : undefined;
}

export async function openMediaTicket(ticket: MediaTicket, range: string | undefined, fetcher: Fetcher = fetch, timeoutMs = 15_000): Promise<Response> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers: Record<string, string> = { accept: 'audio/*,application/octet-stream;q=.9,*/*;q=.5' };
  const safeRange = safeRangeHeader(range); if (safeRange) headers.range = safeRange;
  if (ticket.source === 'kuwo') headers.referer = 'https://www.kuwo.cn/';
  if (ticket.source === 'netease') headers.referer = 'https://music.163.com/';
  if (ticket.source === 'qq') headers.referer = 'https://y.qq.com/';
  if (ticket.source === 'migu') headers.referer = 'https://music.migu.cn/';
  try {
    let url = ticket.url;
    for (let redirects = 0; redirects <= 4; redirects += 1) {
      const response = await fetcher(url, { headers, signal: controller.signal, redirect: 'manual' });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel().catch(() => undefined);
        const next = location ? allowedMediaUrl(new URL(location, url).toString(), ticket.source) : null;
        if (!next) throw new Error('Unsafe media redirect');
        if (redirects === 4) throw new Error('Too many media redirects');
        url = next;
        continue;
      }
      const type = response.headers.get('content-type') || '';
      if (![200, 206].includes(response.status) || !response.body || type && !/^(audio\/|application\/octet-stream)/i.test(type)) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error(`Invalid media response: ${response.status} ${type || 'unknown content type'}`);
      }
      return response;
    }
    throw new Error('Too many media redirects');
  } finally { clearTimeout(timer); }
}
