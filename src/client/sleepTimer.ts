import { useCallback, useEffect, useRef, useState } from 'react';

export const SLEEP_TIMER_MINUTES = [15, 30, 45, 60, 90] as const;

export function formatSleepRemaining(ms: number) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(seconds / 3600); const minutes = Math.floor(seconds / 60) % 60;
  const clock = `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  return hours ? `${hours}:${clock}` : clock;
}

// The deadline is a wall-clock time, so a page the system throttled in the
// background still stops on its next tick instead of counting slowly.
export function useSleepTimer(onExpire: () => void) {
  const [deadline, setDeadline] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now);
  const expire = useRef(onExpire); expire.current = onExpire;
  const armed = useRef<number | null>(null);

  const check = useCallback(() => {
    if (armed.current === null || Date.now() < armed.current) return;
    armed.current = null; setDeadline(null); expire.current();
  }, []);
  const start = useCallback((minutes: number) => {
    const next = Date.now() + minutes * 60_000;
    armed.current = next; setDeadline(next); setNow(Date.now());
  }, []);
  const cancel = useCallback(() => { armed.current = null; setDeadline(null); }, []);

  useEffect(() => {
    if (deadline === null) return;
    const timer = window.setInterval(() => { setNow(Date.now()); check(); }, 1000);
    return () => window.clearInterval(timer);
  }, [check, deadline]);

  return { remaining: deadline === null ? null : deadline - now, start, cancel, check };
}
