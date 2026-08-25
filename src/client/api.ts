import type { ApiErrorShape } from '../shared/types';

export class ApiError extends Error {
  constructor(public code: string, message: string, public details?: unknown, public status = 500) { super(message); }
}

export const SERVICE_CONNECTION_EVENT = 'pikachu:service-connection';

function reportServiceConnection(online: boolean) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SERVICE_CONNECTION_EVENT, { detail: { online } }));
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers }
    });
    reportServiceConnection(true);
  } catch (cause) {
    reportServiceConnection(false);
    throw new ApiError('SERVICE_UNAVAILABLE', '无法连接音乐服务。请确认本地服务已启动，或稍后重试。', { cause: cause instanceof Error ? cause.message : String(cause) }, 503);
  }
  const type = response.headers.get('content-type') || '';
  const payload = type.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const error = (payload as ApiErrorShape)?.error;
    throw new ApiError(error?.code || 'REQUEST_FAILED', error?.message || String(payload), error?.details, response.status);
  }
  return payload as T;
}

export const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: body === undefined ? undefined : { 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body)
});
