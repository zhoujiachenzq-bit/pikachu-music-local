// The phone runs the real routes from src/server/app.ts inside the WebView. This
// is the small part of Fastify those routes use, called from window.fetch.
type Handler = (request: PhoneRequest, reply: PhoneReply) => unknown;
type ErrorHandler = (error: unknown, request: PhoneRequest, reply: PhoneReply) => unknown;

export interface PhoneRequest {
  url: string; method: string; protocol: string; ip: string;
  headers: Record<string, string>; cookies: Record<string, string>;
  query: Record<string, string>; params: Record<string, string>; body: unknown;
}

export class PhoneReply {
  statusCode = 200; payload: unknown = undefined; sent = false;
  headers = new Headers();
  code(status: number) { this.statusCode = status; return this; }
  header(name: string, value: string) { this.headers.set(name, value); return this; }
  send(payload?: unknown) { this.payload = payload; this.sent = true; return this; }
  redirect(url: string) { this.headers.set('location', url); return this.code(302).send(); }
  setCookie() { return this; }
  clearCookie() { return this; }
}

function compile(path: string) {
  const names: string[] = [];
  const source = path.replace(/:(\w+)/g, (_, name: string) => { names.push(name); return '([^/]+)'; });
  return { pattern: new RegExp(`^${source}$`), names };
}

export class PhoneApp {
  log = { info: () => undefined, error: (error: unknown) => console.error(error) };
  cookies: Record<string, string> = {};
  private routes: Array<{ method: string; pattern: RegExp; names: string[]; handler: Handler }> = [];
  private hooks: Handler[] = [];
  private errorHandler: ErrorHandler = error => { throw error; };

  async register() { return this; }
  addHook(name: string, hook: Handler) { if (name === 'onRequest') this.hooks.push(hook); return this; }
  setErrorHandler(handler: ErrorHandler) { this.errorHandler = handler; return this; }
  setNotFoundHandler() { return this; }
  private route(method: string, path: string, handler: Handler) { this.routes.push({ method, ...compile(path), handler }); return this; }
  get(path: string, handler: Handler) { return this.route('GET', path, handler); }
  post(path: string, handler: Handler) { return this.route('POST', path, handler); }
  patch(path: string, handler: Handler) { return this.route('PATCH', path, handler); }
  delete(path: string, handler: Handler) { return this.route('DELETE', path, handler); }

  async handle(input: string, init: RequestInit = {}): Promise<Response> {
    const url = new URL(input, 'https://phone.local'); const method = (init.method || 'GET').toUpperCase();
    const reply = new PhoneReply();
    const request: PhoneRequest = {
      url: `${url.pathname}${url.search}`, method, protocol: 'https', ip: '127.0.0.1', headers: {}, cookies: this.cookies,
      query: Object.fromEntries(url.searchParams), params: {},
      body: typeof init.body === 'string' && init.body ? JSON.parse(init.body) : undefined
    };
    try {
      for (const hook of this.hooks) { await hook(request, reply); if (reply.sent) return toResponse(reply); }
      const route = this.routes.find(item => item.method === method && item.pattern.test(url.pathname));
      if (!route) return toResponse(reply.code(404).send({ error: { code: 'NOT_FOUND', message: '资源不存在。' } }));
      const match = url.pathname.match(route.pattern)!;
      route.names.forEach((name, index) => { request.params[name] = decodeURIComponent(match[index + 1]); });
      const value = await route.handler(request, reply);
      if (!reply.sent && value !== undefined) reply.send(value);
    } catch (error) {
      reply.headers.delete('location');
      await this.errorHandler(error, request, reply);
    }
    return toResponse(reply);
  }
}

function toResponse(reply: PhoneReply) {
  const body = reply.payload === undefined ? null : JSON.stringify(reply.payload);
  if (body) reply.headers.set('content-type', 'application/json');
  return new Response(body, { status: reply.statusCode, headers: reply.headers });
}

export default function Fastify() { return new PhoneApp(); }
