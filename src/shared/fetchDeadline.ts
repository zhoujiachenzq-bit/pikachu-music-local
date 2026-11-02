// Older Android WebViews have AbortController but no AbortSignal.timeout().
// Keep the deadline active while the response body is being decoded as well.
export async function fetchJsonWithDeadline(url: string, init: RequestInit = {}, timeout = 12000) {
  const controller = new AbortController();
  const abort = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) abort();
  else init.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body: unknown = await response.json();
    return { response, body };
  } finally { clearTimeout(timer); init.signal?.removeEventListener('abort', abort); }
}
