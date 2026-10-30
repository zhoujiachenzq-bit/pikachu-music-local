import { useCallback, useEffect, useRef, useState, type TouchEvent } from 'react';

export type SwipeDirection = 'up' | 'down' | null;

/** A swipe must be mostly vertical, and either long or quick. */
export function classifySwipe(deltaX: number, deltaY: number, elapsedMs: number): SwipeDirection {
  const distance = Math.abs(deltaY);
  if (distance < Math.abs(deltaX) * 1.4) return null;
  if (distance < 64 && !(distance >= 28 && elapsedMs <= 220)) return null;
  return deltaY < 0 ? 'up' : 'down';
}

/**
 * The phone's lyrics page: a sheet resting below the console. It follows the
 * finger, and its open state is a history entry, so the Android back button
 * closes the sheet instead of leaving the app.
 */
export function useLyricsSheet(enabled: boolean) {
  const [open, setOpen] = useState(false);
  const sheet = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ x: number; y: number; at: number; dragging: boolean } | null>(null);

  const show = useCallback(() => {
    if (window.history.state?.lyricsSheet) return;
    window.history.pushState({ lyricsSheet: true }, '');
    setOpen(true);
  }, []);
  const hide = useCallback(() => {
    if (window.history.state?.lyricsSheet) window.history.back();
    else setOpen(false);
  }, []);

  useEffect(() => {
    const sync = () => setOpen(Boolean(window.history.state?.lyricsSheet));
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  useEffect(() => { if (!enabled && open) hide(); }, [enabled, hide, open]);

  const setDrag = (distance: number | null) => {
    const element = sheet.current; if (!element) return;
    element.classList.toggle('is-dragging', distance !== null);
    if (distance === null) element.style.removeProperty('--sheet-drag');
    else element.style.setProperty('--sheet-drag', `${distance}px`);
  };

  const onTouchStart = useCallback((event: TouchEvent<HTMLElement>) => {
    gesture.current = null;
    if (!enabled || event.touches.length !== 1) return;
    const target = event.target as HTMLElement;
    // Sliders keep their own drag; an open sheet scrolls lyrics, so only its top bar moves it.
    if (target.closest('input, select') || (open && !target.closest('.lyrics-page-bar'))) return;
    const touch = event.touches[0];
    gesture.current = { x: touch.clientX, y: touch.clientY, at: event.timeStamp, dragging: false };
  }, [enabled, open]);

  const onTouchMove = useCallback((event: TouchEvent<HTMLElement>) => {
    const start = gesture.current; if (!start) return;
    const touch = event.touches[0];
    const deltaX = touch.clientX - start.x; const deltaY = touch.clientY - start.y;
    if (!start.dragging && Math.abs(deltaY) > 10 && Math.abs(deltaY) > Math.abs(deltaX)) start.dragging = true;
    if (start.dragging) setDrag(open ? Math.max(0, deltaY) : Math.min(0, deltaY));
  }, [open]);

  const onTouchEnd = useCallback((event: TouchEvent<HTMLElement>) => {
    const start = gesture.current; gesture.current = null;
    setDrag(null);
    if (!start) return;
    const touch = event.changedTouches[0];
    const swipe = classifySwipe(touch.clientX - start.x, touch.clientY - start.y, event.timeStamp - start.at);
    if (swipe === 'up' && !open) show();
    else if (swipe === 'down' && open) hide();
  }, [hide, open, show]);

  return { open, sheet, show, hide, touch: { onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: onTouchEnd } };
}
