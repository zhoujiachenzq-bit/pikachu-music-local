import { existsSync } from 'node:fs';
import { createApp } from './app.js';

if (existsSync('.env')) process.loadEnvFile('.env');

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const app = await createApp({ logger: true });

try {
  await app.listen({ host, port });
  console.log(`音乐小屋已启动：http://${host}:${port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
