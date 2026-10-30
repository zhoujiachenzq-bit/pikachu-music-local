// Music sources allow neither browser CORS nor a custom Referer, so the phone sends
// their requests through Android's HTTP stack instead of the WebView's.
export interface NativeRequest {
  url: string; method: string; headers: Record<string, string>; data?: unknown; responseType: 'text';
  connectTimeout: number; readTimeout: number; disableRedirects: boolean;
}
export interface NativeResponse { status: number; url?: string; headers: Record<string, unknown>; data: unknown }
type NativeHttp = (options: NativeRequest) => Promise<NativeResponse>;

const NULL_BODY_STATUS = [101, 204, 205, 304];
const TIMEOUT_MS = 12_000;

function requestBody(body: BodyInit | null | undefined, contentType: string | null) {
  if (typeof body !== 'string') return undefined;
  return contentType?.includes('json') ? JSON.parse(body) : body;
}

function responseHeaders(raw: Record<string, unknown>) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    try { headers.set(name, Array.isArray(value) ? value.join(', ') : String(value)); } catch { /* The status line arrives with an invalid header name. */ }
  }
  return headers;
}

export function createNativeFetch(http: NativeHttp) {
  return async (url: string, init: RequestInit = {}): Promise<Response> => {
    init.signal?.throwIfAborted();
    const method = (init.method || 'GET').toUpperCase(); const headers = new Headers(init.headers);
    const pending = http({
      url, method, headers: Object.fromEntries(headers), data: requestBody(init.body, headers.get('content-type')), responseType: 'text',
      connectTimeout: TIMEOUT_MS, readTimeout: TIMEOUT_MS, disableRedirects: init.redirect === 'manual'
    });
    const aborted = new Promise<never>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    });
    const answer = await Promise.race([pending, aborted]);
    const text = typeof answer.data === 'string' ? answer.data : answer.data == null ? '' : JSON.stringify(answer.data);
    const empty = method === 'HEAD' || NULL_BODY_STATUS.includes(answer.status);
    const response = new Response(empty ? null : text, { status: answer.status, headers: responseHeaders(answer.headers) });
    Object.defineProperty(response, 'url', { value: answer.url || url });
    return response;
  };
}
