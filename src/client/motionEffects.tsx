// Adapted from React Bits FadeContent and ClickSpark (David Haz).
// See docs/react-bits-motion.md and third_party/react-bits-LICENSE.md.
import { useCallback, useEffect, useRef, useState, type MouseEvent, type RefObject } from 'react';

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update); update();
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

/** Fade the existing surface without remounting its children or moving focus. */
export function useFadeContent(ref: RefObject<HTMLDivElement | null>, trigger: string, enabled: boolean, active: boolean) {
  useEffect(() => {
    if (!enabled || !active || !ref.current?.animate) return;
    const animation = ref.current.animate([{ opacity: .35 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' });
    return () => animation.cancel();
  }, [ref, trigger, enabled, active]);
}

export interface SparkPoint { x: number; y: number }
export interface SparkBurst extends SparkPoint { id: number }

export function sparkPoint(event?: MouseEvent<HTMLButtonElement>): SparkPoint | undefined {
  if (!event) return undefined;
  const rect = event.currentTarget.getBoundingClientRect();
  // Keyboard clicks have no pointer coordinates: use the button's center.
  return event.detail === 0 ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : { x: event.clientX, y: event.clientY };
}

export function useSuccessSpark(enabled: boolean, accountId?: string) {
  const [burst, setBurst] = useState<SparkBurst | null>(null);
  const latest = useRef({ enabled, accountId });
  latest.current = { enabled, accountId };
  const sequence = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setBurst(null); }, [enabled, accountId]);
  useEffect(() => {
    if (!burst) return;
    const timer = window.setTimeout(() => setBurst(null), 460);
    return () => window.clearTimeout(timer);
  }, [burst]);
  const celebrate = useCallback((point?: SparkPoint) => {
    if (!point || !mounted.current || !latest.current.enabled || latest.current.accountId !== accountId || document.hidden) return;
    setBurst({ ...point, id: ++sequence.current });
  }, [accountId]);
  return { burst: enabled ? burst : null, celebrate };
}

/** A small, finite canvas burst; no click listener and no idle animation loop. */
export function SuccessSpark({ burst, colors }: { burst: SparkBurst; colors: readonly [string, string] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const colorA = colors[0]; const colorB = colors[1];
  useEffect(() => {
    const canvas = ref.current; const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = canvas.height = 96 * dpr;
    ctx.scale(dpr, dpr);
    let frame = 0; let start: number | undefined;
    const draw = (time: number) => {
      start ??= time;
      ctx.clearRect(0, 0, 96, 96);
      const progress = Math.min(1, (time - start) / 420);
      if (document.hidden || progress >= 1) return;
      const eased = progress * (2 - progress);
      for (let i = 0; i < 8; i++) {
        const angle = Math.PI * 2 * i / 8;
        const distance = 6 + eased * 28; const length = 9 * (1 - eased);
        ctx.strokeStyle = i % 2 ? colorA : colorB; ctx.lineWidth = 2;
        ctx.globalAlpha = 1 - progress; ctx.lineCap = 'round'; ctx.beginPath();
        ctx.moveTo(48 + distance * Math.cos(angle), 48 + distance * Math.sin(angle));
        ctx.lineTo(48 + (distance + length) * Math.cos(angle), 48 + (distance + length) * Math.sin(angle)); ctx.stroke();
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [burst.id, colorA, colorB]);
  return <canvas ref={ref} className="success-spark" aria-hidden="true" style={{ left: burst.x - 48, top: burst.y - 48 }}/>;
}
