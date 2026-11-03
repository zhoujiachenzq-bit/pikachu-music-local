import { resolve } from 'node:path';
import { createApp } from './dist/server/server/app.js';

const app = await createApp({ logger: false, trustProxy: false, staticDir: resolve(import.meta.dirname, 'dist/client') });
await app.listen({ host: '127.0.0.1', port: 0 });
console.log(JSON.stringify({ ready: true, port: app.server.address().port }));
process.once('message', message => { if (message === 'shutdown') void app.close().then(() => process.exit(0)); });
process.once('disconnect', () => { void app.close().then(() => process.exit(0)); });
