import { createApp } from './app.js';

const port = Number(process.env.PORT || 3000);
const app = await createApp({ logger: true });

try {
  await app.listen({ host: '127.0.0.1', port });
  console.log(`皮卡丘音乐站已启动：http://127.0.0.1:${port}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
