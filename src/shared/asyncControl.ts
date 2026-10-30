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

