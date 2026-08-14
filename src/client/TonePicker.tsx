import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './ui';
import { TONE_THEMES, TONE_THEME_IDS, type ToneThemeId } from './visualTheme';

export interface ToneTransitionState {
  id: number;
  x: number;
  y: number;
  color: string;
  duration: number;
  reduced: boolean;
}

interface TonePickerProps {
  activeTheme: ToneThemeId;
  committedTheme: ToneThemeId;
  lang: 'zh' | 'en';
  motionEnabled: boolean;
  onCommit: (theme: ToneThemeId, origin: { x: number; y: number }) => void;
  onMotionChange: (enabled: boolean) => void;
  onPreview: (theme: ToneThemeId | null) => void;
}

export function TonePicker({ activeTheme, committedTheme, lang, motionEnabled, onCommit, onMotionChange, onPreview }: TonePickerProps) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState({ top: 0, right: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const zh = lang === 'zh';

  const close = () => { setOpen(false); onPreview(null); };
  const toggle = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setAnchor({ top: rect.bottom + 9, right: Math.max(10, window.innerWidth - rect.right) });
    setOpen(value => { if (value) onPreview(null); return !value; });
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    const onResize = () => close();
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  const commit = (theme: ToneThemeId, event: ReactMouseEvent<HTMLButtonElement>) => {
    const fallback = triggerRef.current?.getBoundingClientRect();
    onCommit(theme, {
      x: event.clientX || (fallback ? fallback.left + fallback.width / 2 : window.innerWidth / 2),
      y: event.clientY || (fallback ? fallback.top + fallback.height / 2 : 36),
    });
    setOpen(false);
  };

  const panel = open ? <section
    ref={panelRef}
    className="tone-panel"
    data-tone={activeTheme}
    role="dialog"
    aria-label={zh ? '网站色调' : 'Site tone'}
    style={{ '--tone-top': `${anchor.top}px`, '--tone-right': `${anchor.right}px` } as CSSProperties}
    onMouseLeave={() => onPreview(null)}
  >
    <header><div><span>{zh ? '视觉色调' : 'Visual tone'}</span><strong>{zh ? '为音乐小屋换一种气氛' : 'Change the room atmosphere'}</strong></div><button onClick={close} aria-label={zh ? '关闭' : 'Close'}><Icon name="close" size={14}/></button></header>
    <div className="tone-grid">
      {TONE_THEME_IDS.map(id => {
        const theme = TONE_THEMES[id];
        return <button
          key={id}
          className={`tone-card ${activeTheme === id ? 'active' : ''} ${committedTheme === id ? 'committed' : ''}`}
          onMouseEnter={() => window.matchMedia('(hover: hover)').matches && onPreview(id)}
          onFocus={() => onPreview(id)}
          onBlur={() => onPreview(null)}
          onClick={event => commit(id, event)}
          aria-pressed={committedTheme === id}
          style={{ '--swatch-a': theme.swatches[0], '--swatch-b': theme.swatches[1], '--swatch-c': theme.swatches[2] } as CSSProperties}
        >
          <span className="tone-swatch"><i/><i/><i/></span>
          <span><strong>{theme.name[lang]}</strong><small>{theme.description[lang]}</small></span>
          {committedTheme === id && <i className="tone-check">✓</i>}
        </button>;
      })}
    </div>
    <button className={`motion-toggle ${motionEnabled ? 'active' : ''}`} onClick={() => onMotionChange(!motionEnabled)} aria-pressed={motionEnabled}>
      <span><Icon name="motion" size={16}/></span>
      <span><strong>{zh ? '动态场景' : 'Motion scene'}</strong><small>{zh ? '自动适配桌面与平板性能' : 'Adapts to desktop and tablet performance'}</small></span>
      <i/>
    </button>
  </section> : null;

  return <>
    <button ref={triggerRef} className={`tone-trigger ${open ? 'active' : ''}`} onClick={toggle} aria-label={zh ? '切换网站色调' : 'Change site tone'} aria-expanded={open} aria-haspopup="dialog">
      <Icon name="palette" size={16}/><i style={{ background: TONE_THEMES[committedTheme].sceneAccent }}/>
    </button>
    {panel && createPortal(panel, document.body)}
  </>;
}

export function ToneTransitionLayer({ transition }: { transition: ToneTransitionState | null }) {
  if (!transition) return null;
  return createPortal(<div
    key={transition.id}
    className={`tone-transition ${transition.reduced ? 'reduced' : ''}`}
    aria-hidden="true"
    style={{ '--tone-origin-x': `${transition.x}px`, '--tone-origin-y': `${transition.y}px`, '--tone-curtain': transition.color, '--tone-duration': `${transition.duration}ms` } as CSSProperties}
  ><i/><span/></div>, document.body);
}
