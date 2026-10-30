// Browser stand-ins for the node: imports that src/server reaches on the phone.
// The phone has one local user and no passwords, so hashing only needs to give a
// stable lookup key, and the scrypt path behind password login is never called.
export const randomUUID = () => crypto.randomUUID();

export function randomBytes(size: number) {
  const bytes = crypto.getRandomValues(new Uint8Array(size));
  return { toString: () => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('') };
}

export function createHash() {
  let value = '';
  const hash = { update(text: string) { value += text; return hash; }, digest() { return value; } };
  return hash;
}

export function scrypt() { throw new Error('手机版不使用密码。'); }
export function timingSafeEqual() { return false; }
export function promisify<T>(value: T) { return value; }

export const existsSync = () => false;
export const mkdirSync = () => undefined;
export const resolve = (path: string) => path;
export const dirname = (path: string) => path;
export const Readable = { fromWeb: <T>(stream: T) => stream };
