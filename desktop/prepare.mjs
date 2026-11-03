import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
const staging = resolve(root, 'data/windows');
const runtime = resolve(staging, 'portable-runtime');
mkdirSync(runtime, { recursive: true });
const project = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const dependencies = Object.fromEntries(['fastify', '@fastify/cookie', '@fastify/static', 'qrcode', 'zod'].map(key => [key, JSON.parse(readFileSync(resolve(root, 'node_modules', key, 'package.json'), 'utf8')).version]));
writeFileSync(resolve(runtime, 'package.json'), JSON.stringify({ name: 'music-house-windows-runtime', private: true, version: project.version, type: 'module', dependencies }, null, 2));
copyFileSync(process.execPath, resolve(staging, 'node.exe'));
if (existsSync(resolve(root, 'desktop/runtime-package-lock.json'))) copyFileSync(resolve(root, 'desktop/runtime-package-lock.json'), resolve(runtime, 'package-lock.json'));
if (!existsSync(resolve(staging, 'NODE-LICENSE'))) {
  const license = await fetch(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`);
  if (!license.ok) throw new Error('Could not download the bundled Node license.');
  writeFileSync(resolve(staging, 'NODE-LICENSE'), await license.text());
}
copyFileSync(resolve(root, 'desktop/server.mjs'), resolve(runtime, 'server.mjs'));
cpSync(resolve(root, 'dist/server'), resolve(runtime, 'dist/server'), { recursive: true });
cpSync(resolve(root, 'dist/client/assets'), resolve(runtime, 'dist/client/assets'), { recursive: true });
copyFileSync(resolve(root, 'dist/client/index.html'), resolve(runtime, 'dist/client/index.html'));
// Only committed public assets are distributable; unrelated local artwork stays local.
const assets = execFileSync('git', ['ls-files', '-z', '--', 'public'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
for (const asset of assets) {
  const relative = asset.slice('public/'.length);
  const destination = resolve(runtime, 'dist/client', relative);
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(resolve(root, 'dist/client', relative), destination);
}
if (!existsSync(resolve(runtime, 'dist/client/index.html'))) throw new Error('Build the web app first.');
console.log('Windows runtime staged without local accounts, environment files or keys.');
