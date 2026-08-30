import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { publishTrendSnapshot, type TrendSnapshotInput } from '../src/server/agentTrends.js';

const itemSchema = z.object({
  id: z.string().trim().min(1).max(200), rank: z.number().int().min(1).max(500), title: z.string().trim().min(1).max(300), artist: z.string().trim().min(1).max(300),
  sourceUrl: z.string().url(), durationMs: z.number().int().positive().nullable().optional(), coverUrl: z.string().url().nullable().optional()
});
const snapshotSchema = z.object({ provider: z.enum(['douyin', 'qishui']), collectedAt: z.string().datetime(), items: z.array(itemSchema).min(1).max(500) });

async function main() {
  const file = process.argv[2]; if (!file) throw new Error('用法：pnpm agent:publish-trends -- <snapshot.json>');
  const url = process.env.KNOWLEDGE_PUBLISH_URL || ''; const secret = process.env.KNOWLEDGE_PUBLISH_HMAC_KEY || '';
  if (!url || !secret) throw new Error('请在本机环境中配置 KNOWLEDGE_PUBLISH_URL 与 KNOWLEDGE_PUBLISH_HMAC_KEY。');
  const input = snapshotSchema.parse(JSON.parse(await readFile(resolve(file), 'utf8'))) as TrendSnapshotInput;
  const result = await publishTrendSnapshot(url, secret, input);
  process.stdout.write(`${JSON.stringify({ ok: true, provider: input.provider, collectedAt: input.collectedAt, result }, null, 2)}\n`);
}

main().catch(error => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
