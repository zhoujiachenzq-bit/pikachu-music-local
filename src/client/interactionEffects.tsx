// Adapted from React Bits ElasticSlider, GlassIcons, TiltedCard and CardNav.
// See third_party/react-bits-LICENSE.md. Native controls remain authoritative.
import { useEffect, useRef, type InputHTMLAttributes, type PointerEvent, type ReactNode } from 'react';
import { useReducedMotion } from './motionEffects';

export function GlassIcon({ children }: { children: ReactNode }) {
  return <span className="glass-icon" aria-hidden="true"><span className="glass-back"/><span className="glass-front">{children}</span></span>;
}

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

export function TiltSurface({ children, enabled, className = '', intensity = 6 }: { children: ReactNode; enabled: boolean; className?: string; intensity?: number }) {
  const root = useRef<HTMLSpanElement>(null); const frame = useRef(0);
  const reduced = useReducedMotion();
  const reset = () => {
    cancelAnimationFrame(frame.current);
    root.current?.style.setProperty('--tilt-x', '0deg'); root.current?.style.setProperty('--tilt-y', '0deg');
    root.current?.style.setProperty('--tilt-scale', '1');
  };
  useEffect(() => { if (!enabled || reduced) reset(); return () => cancelAnimationFrame(frame.current); }, [enabled, reduced]);
  return <span ref={root} className={`tilt-surface ${className}`} onPointerLeave={reset} onPointerCancel={reset} onPointerMove={event => {
    if (!enabled || reduced || event.pointerType !== 'mouse' || !window.matchMedia('(min-width: 761px) and (hover: hover)').matches) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, (event.clientX - rect.left) / rect.width * 2 - 1));
    const y = Math.max(-1, Math.min(1, (event.clientY - rect.top) / rect.height * 2 - 1));
    cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(() => {
      root.current?.style.setProperty('--tilt-x', `${-y * intensity}deg`); root.current?.style.setProperty('--tilt-y', `${x * intensity}deg`);
      root.current?.style.setProperty('--tilt-scale', '1.03');
    });
  }}>{children}</span>;
}

export function SettingsCardNav({ zh }: { zh: boolean }) {
  const reduced = useReducedMotion();
  return <details className="settings-card-nav" open><summary>{zh ? '设置导航' : 'Settings navigation'}<span aria-hidden="true">↗</span></summary>
    <div>{[
      ['identity', '01', zh ? '身份与陪伴' : 'Identity & companionship', zh ? '称呼 · 性格 · 陪伴方式' : 'Name · tone · behavior'],
      ['voice', '02', zh ? '声音' : 'Voice', zh ? '音色 · 试听 · 朗读' : 'Voice · preview · read aloud'],
      ['data', '03', zh ? '记忆与数据' : 'Memory & data', zh ? '记忆 · 知识 · 加密档案' : 'Memory · knowledge · archives'],
    ].map(([id, number, label, detail]) => <button key={id} type="button" onClick={event => {
      const panel = event.currentTarget.closest('.agent-settings');
      const scroller = panel?.querySelector<HTMLElement>('.agent-settings-scroll');
      const target = panel?.querySelector<HTMLElement>(`[data-settings-section="${id}"]`);
      if (!target || !scroller) return;
      const top = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 12;
      scroller.scrollTo({ top, behavior: !reduced && panel?.closest('.motion-on') ? 'smooth' : 'instant' });
      target.focus({ preventScroll: true });
    }}><small>{number}</small><strong>{label}</strong><span>{detail}</span></button>)}</div>
  </details>;
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
