import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { PlatformItem, PlatformResult } from '../shared/platform';
import { SOURCE_NAMES } from '../shared/types';
import { Icon } from './ui';

// Platform playlists are a separate feed; they never delay the daily track list.
export function DailyCollections({ onOpen }: { onOpen: (item: PlatformItem) => void }) {
  const [items, setItems] = useState<PlatformItem[]>([]);
  const [status, setStatus] = useState('加载中…');
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const drag = useRef<{ x: number; scroll: number; moved: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    setStatus('加载中…');
    setLoading(true);
    void Promise.allSettled(['netease', 'qq'].map(source => api<PlatformResult>(`/api/platform/browse?mode=recommend&source=${source}`))).then(results => {
      if (!active) return;
      const feeds = results.map(result => result.status === 'fulfilled' ? result.value.items : []);
      const mixed = Array.from({ length: 6 }, (_, i) => feeds[i % 2][Math.floor(i / 2)]).filter((item): item is PlatformItem => Boolean(item));
      setItems(mixed); setStatus(mixed.length ? '' : '暂时无法获取歌单'); setLoading(false);
    });
    return () => { active = false; };
  }, [revision]);
  return <section className="daily-collections" aria-label="推荐歌单" aria-busy={loading}>
    <header><h3>推荐歌单</h3><button className="collection-refresh" disabled={loading} onClick={() => { setLoading(true); setRevision(value => value + 1); }} aria-label="刷新推荐歌单"><Icon name="sync" size={17}/><span>{loading ? '加载中' : '换一批'}</span></button></header>
    {status && (!loading || !items.length) && <p role="status">{status}</p>}
    <div className="daily-collection-rail"
      onPointerDown={event => { drag.current = event.pointerType === 'mouse' && event.button === 0 ? { x: event.clientX, scroll: event.currentTarget.scrollLeft, moved: false } : null; }}
      onPointerMove={event => { const start = drag.current; if (!start || event.buttons !== 1) return; const delta = event.clientX - start.x; if (!start.moved && Math.abs(delta) > 6) { start.moved = true; event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.dataset.dragging = 'true'; } if (start.moved) event.currentTarget.scrollLeft = start.scroll - delta; }}
      onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); delete event.currentTarget.dataset.dragging; }}
      onPointerCancel={event => { drag.current = null; delete event.currentTarget.dataset.dragging; }}
      onClickCapture={event => { if (drag.current?.moved) { event.preventDefault(); event.stopPropagation(); drag.current = null; } }}
    >{items.map(item => <button key={`${item.source}:${item.id}`} onClick={() => onOpen(item)}>
      {item.cover ? <img src={item.cover} alt="" draggable={false} loading="lazy" onError={event => { event.currentTarget.style.visibility = 'hidden'; }}/> : <span><Icon name="library" size={30}/></span>}
      <strong>{item.name}</strong><small>{SOURCE_NAMES[item.source]}</small>
    </button>)}</div>
  </section>;
}
