/** Stop waiting without leaving an unobserved rejection or a retained listener. */
export function abortable<T>(operation: PromiseLike<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return Promise.resolve(operation);
  return new Promise<T>((resolve, reject) => {
    const abort = () => finish(() => reject(signal.reason ?? new DOMException('Aborted', 'AbortError')));
    const finish = (settle: () => void) => { signal.removeEventListener('abort', abort); settle(); };
    Promise.resolve(operation).then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  });
}

export function deadline(ms: number, parent?: AbortSignal, code = 'TIMEOUT') {
  const controller = new AbortController();
  const abort = () => controller.abort(parent?.reason);
  const timer = setTimeout(() => controller.abort(new Error(code)), ms);
  if (parent?.aborted) abort(); else parent?.addEventListener('abort', abort, { once: true });
  return {
    signal: controller.signal,
    dispose() { clearTimeout(timer); parent?.removeEventListener('abort', abort); }
  };
}

export function boundedDuration(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(Math.max(minimum, Math.min(maximum, parsed))) : fallback;
}

export async function* abortableStream<T>(source: AsyncIterable<T>, signal?: AbortSignal): AsyncGenerator<T> {
  const iterator = source[Symbol.asyncIterator]();
  try {
    for (;;) { signal?.throwIfAborted(); const item = await abortable(iterator.next(), signal); signal?.throwIfAborted(); if (item.done) return; yield item.value; }
  } finally { if (iterator.return) void Promise.resolve(iterator.return()).catch(() => undefined); }
}
