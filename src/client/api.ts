import type { ApiErrorShape } from '../shared/types';

export class ApiError extends Error {
  constructor(public code: string, message: string, public details?: unknown, public status = 500) { super(message); }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers }
  });
  const type = response.headers.get('content-type') || '';
  const payload = type.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const error = (payload as ApiErrorShape)?.error;
    throw new ApiError(error?.code || 'REQUEST_FAILED', error?.message || String(payload), error?.details, response.status);
  }
  return payload as T;
}

export const json = (method: string, body?: unknown): RequestInit => ({ method, body: body === undefined ? undefined : JSON.stringify(body) });
