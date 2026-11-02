// Adapted from React Bits ElasticSlider, GlassIcons, TiltedCard and CardNav.
// See third_party/react-bits-LICENSE.md. Native controls remain authoritative.
import { useEffect, useRef, type InputHTMLAttributes, type PointerEvent, type ReactNode } from 'react';
import { useReducedMotion } from './motionEffects';

export function ElasticVolume({ motionEnabled, ...props }: InputHTMLAttributes<HTMLInputElement> & { motionEnabled: boolean }) {
  const visual = useRef<HTMLSpanElement>(null);
  const spring = useRef<Animation | null>(null);
  const reduced = useReducedMotion();
  const activePointer = useRef<number | null>(null);
  const reset = () => {
    if (activePointer.current === null) return;
    activePointer.current = null;
    const el = visual.current;
    if (!el) return;
    const from = el.style.transform || 'none';
    spring.current?.cancel(); el.style.transform = 'none';
    if (motionEnabled && !reduced && from !== 'none') spring.current = el.animate(
      [{ transform: from }, { transform: 'scaleX(.97)' }, { transform: 'scaleX(1.015)' }, { transform: 'none' }],
      { duration: 360, easing: 'ease-out' },
    );
  };
  useEffect(() => { if (!motionEnabled || reduced) { spring.current?.cancel(); if (visual.current) visual.current.style.transform = 'none'; } }, [motionEnabled, reduced]);
  useEffect(() => () => { spring.current?.cancel(); }, []);
  const move = (event: PointerEvent<HTMLInputElement>) => {
    if (activePointer.current !== event.pointerId || !visual.current || !motionEnabled || reduced) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const excess = Math.max(rect.left - event.clientX, event.clientX - rect.right, 0);
    // React Bits' decay curve, limited to 12px instead of 50px for this compact control.
    const overflow = 12 * (2 / (1 + Math.exp(-excess / 12)) - 1);
    visual.current.style.transformOrigin = event.clientX < rect.left ? 'right center' : 'left center';
    visual.current.style.transform = `scale(${1 + overflow / Math.max(rect.width, 1)},${1 - overflow / 80})`;
  };
  const percentage = Math.max(0, Math.min(100, Number(props.value || 0) * 100));
  return <span className="elastic-volume" data-no-ripple="true">
    <span ref={visual} className="elastic-volume-visual" aria-hidden="true"><span style={{ width: `${percentage}%` }}/></span>
    <input {...props} className={`${props.className || ''} elastic-volume-input`} aria-valuetext={`${Math.round(percentage)}%`}
      onPointerDown={event => { activePointer.current = event.pointerId; spring.current?.cancel(); props.onPointerDown?.(event); }}
      onPointerMove={event => { move(event); props.onPointerMove?.(event); }}
      onPointerUp={event => { reset(); props.onPointerUp?.(event); }}
      onPointerCancel={event => { reset(); props.onPointerCancel?.(event); }}
      onLostPointerCapture={event => { const interrupted = activePointer.current !== null; reset(); if (interrupted) props.onPointerUp?.(event); props.onLostPointerCapture?.(event); }}
      onBlur={event => { reset(); props.onBlur?.(event); }}/>
    <span className="elastic-volume-value" aria-hidden="true">{Math.round(percentage)}%</span>
  </span>;
}

const TILT_VARS = ['--tilt-x', '--tilt-y', '--tilt-z', '--tilt-scale', '--glare-x', '--glare-y'];

/** Tilts a surface toward the pointer; `touch` adds a gentler press tilt. Spin belongs on a child layer, never on this one. */
export function TiltSurface({ children, enabled, className = '', intensity = 6, glare = false, touch = false }: { children: ReactNode; enabled: boolean; className?: string; intensity?: number; glare?: boolean; touch?: boolean }) {
  const root = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();
  const active = enabled && !reduced;
  useEffect(() => {
    const surface = root.current; const host = surface?.parentElement;
    if (!surface || !host || !active) return;
    let frame = 0; let rect: DOMRect | null = null; let target: { x: number; y: number; depth: number; scale: number } | null = null;
    const draw = () => {
      frame = 0;
      if (!target) return;
      const { x, y, depth, scale } = target; const style = surface.style;
      style.setProperty('--tilt-x', `${-y * intensity * depth}deg`); style.setProperty('--tilt-y', `${x * intensity * depth}deg`);
      // The small twist reads as warp while rotation keeps the artwork's proportions.
      style.setProperty('--tilt-z', `${x * y * 1.6 * depth}deg`); style.setProperty('--tilt-scale', String(scale));
      style.setProperty('--glare-x', `${x * 25}%`); style.setProperty('--glare-y', `${y * 25}%`);
    };
    const aim = (event: globalThis.PointerEvent, depth: number, scale: number) => {
      // The host stays still, so tilting can neither move the pointer out of bounds nor skew this measurement.
      rect ??= host.getBoundingClientRect();
      const x = Math.max(-1, Math.min(1, (event.clientX - rect.left) / rect.width * 2 - 1));
      const y = Math.max(-1, Math.min(1, (event.clientY - rect.top) / rect.height * 2 - 1));
      target = { x, y, depth, scale }; surface.dataset.tilting = 'true';
      frame ||= requestAnimationFrame(draw);
    };
    const release = () => {
      cancelAnimationFrame(frame); frame = 0; rect = null; target = null;
      delete surface.dataset.tilting;
      for (const name of TILT_VARS) surface.style.removeProperty(name);
    };
    const move = (event: globalThis.PointerEvent) => {
      if (event.pointerType === 'mouse' ? window.matchMedia('(min-width: 761px) and (hover: hover)').matches : touch && target) aim(event, event.pointerType === 'mouse' ? 1 : .4, event.pointerType === 'mouse' ? 1.03 : .985);
    };
    const press = (event: globalThis.PointerEvent) => { if (touch && event.pointerType !== 'mouse') aim(event, .4, .985); };
    const lift = (event: globalThis.PointerEvent) => { if (event.pointerType !== 'mouse') release(); };
    host.addEventListener('pointermove', move, { passive: true }); host.addEventListener('pointerdown', press, { passive: true });
    host.addEventListener('pointerup', lift); host.addEventListener('pointercancel', release); host.addEventListener('pointerleave', release);
    window.addEventListener('blur', release);
    return () => {
      release();
      host.removeEventListener('pointermove', move); host.removeEventListener('pointerdown', press);
      host.removeEventListener('pointerup', lift); host.removeEventListener('pointercancel', release); host.removeEventListener('pointerleave', release);
      window.removeEventListener('blur', release);
    };
  }, [active, intensity, touch]);
  return <span ref={root} className={`tilt-surface ${className}`}>{children}{glare && <span className="tilt-glare" aria-hidden="true"><i/></span>}</span>;
}

/** Localized panel light only; never moves content or listens to editing areas. */
export function usePanelSpotlight(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let frame = 0; let current: HTMLElement | null = null;
    const clear = () => { cancelAnimationFrame(frame); current?.removeAttribute('data-spotlit'); current = null; };
    const move = (event: globalThis.PointerEvent) => {
      if (event.pointerType !== 'mouse' || !(event.target instanceof Element) || event.target.closest('input,textarea,select,[contenteditable]')) { clear(); return; }
      const panel = event.target.closest<HTMLElement>('.app-shell:is([data-tone="night"],[data-tone="vinyl"]) :is(.search-panel,.playlist-panel)');
      if (current !== panel) { clear(); current = panel; }
      if (!panel) return;
      const rect = panel.getBoundingClientRect(); const x = event.clientX - rect.left; const y = event.clientY - rect.top;
      cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { panel.style.setProperty('--spot-x', `${x}px`); panel.style.setProperty('--spot-y', `${y}px`); panel.dataset.spotlit = 'true'; });
    };
    document.addEventListener('pointermove', move, { passive: true }); document.addEventListener('pointerleave', clear);
    return () => { clear(); document.removeEventListener('pointermove', move); document.removeEventListener('pointerleave', clear); };
  }, [enabled]);
}
