import type { ReactNode } from 'react';
import type { MusicSource, RecommendedTrack, Track } from '../shared/types';
import type { MobileSection } from './visualState';

export type IconName = 'add' | 'agent' | 'backup' | 'close' | 'dislike' | 'download' | 'globe' | 'headphones' | 'heart' | 'import' | 'library' | 'microphone' | 'motion' | 'music' | 'next' | 'palette' | 'pause' | 'play' | 'previous' | 'repeat' | 'repeatOne' | 'restore' | 'search' | 'send' | 'settings' | 'shuffle' | 'sparkles' | 'speaker' | 'sync' | 'temporary' | 'user' | 'volume' | 'warning';

const iconPaths: Record<IconName, ReactNode> = {
  add: <><path d="M12 5v14M5 12h14"/></>,
  agent: <><path d="M7 7.5A5 5 0 0 1 12 3a5 5 0 0 1 5 4.5"/><rect x="4" y="7.5" width="16" height="12" rx="5"/><path d="M8 12h.01M16 12h.01M9 16c1.7 1 4.3 1 6 0"/></>,
  backup: <><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6h14v-6"/></>,
  close: <><path d="M6 6l12 12M18 6 6 18"/></>,
  dislike: <><circle cx="12" cy="12" r="8"/><path d="m7 17 10-10"/></>,
  download: <><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 19h14"/></>,
  globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></>,
  headphones: <><path d="M4 14v-2a8 8 0 0 1 16 0v2"/><path d="M4 14h4v6H6a2 2 0 0 1-2-2v-4ZM20 14h-4v6h2a2 2 0 0 0 2-2v-4Z"/></>,
  heart: <><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z"/></>,
  import: <><path d="M12 21V9M7 14l5-5 5 5"/><path d="M5 3h14v4"/></>,
  library: <><path d="M4 4h4v16H4zM10 4h4v16h-4zM16 6l3-1 3 14-3 1z"/></>,
  microphone: <><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8"/></>,
  motion: <><path d="M3 12h3l2-6 4 12 3-9 2 6h4"/></>,
  music: <><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></>,
  next: <><path d="m6 5 10 7-10 7V5ZM18 5v14"/></>,
  pause: <><path d="M8 5v14M16 5v14"/></>,
  palette: <><path d="M12 3a9 9 0 1 0 0 18h1.2a1.8 1.8 0 0 0 1.2-3.1l-.5-.5a1.8 1.8 0 0 1 1.2-3.1H17A4 4 0 0 0 21 10c0-3.9-4-7-9-7Z"/><circle cx="7.5" cy="10" r=".8"/><circle cx="10" cy="6.8" r=".8"/><circle cx="14" cy="6.8" r=".8"/></>,
  play: <><path d="m8 5 11 7-11 7V5Z"/></>,
  previous: <><path d="m18 5-10 7 10 7V5ZM6 5v14"/></>,
  repeat: <><path d="m17 2 4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/></>,
  repeatOne: <><path d="m17 2 4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/><path d="M11 10h2v5"/></>,
  restore: <><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21v-4h14v4"/></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
  send: <><path d="m3 11 18-8-8 18-2-8-8-2Z"/><path d="m11 13 4-4"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V3h4v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9A1.7 1.7 0 0 0 21 10h.1v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
  shuffle: <><path d="M3 6h3c5 0 7 12 12 12h3"/><path d="m17 14 4 4-4 4M3 18h3c2 0 3-1 4-3M14 8c1-1 2-2 4-2h3"/><path d="m17 2 4 4-4 4"/></>,
  sparkles: <><path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4L12 3Z"/><path d="m19 14 .8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14Z"/></>,
  speaker: <><path d="M5 10v4h4l5 4V6l-5 4H5Z"/><path d="M17 9a4 4 0 0 1 0 6"/></>,
  sync: <><path d="M20 7h-5V2"/><path d="M20 7a8 8 0 1 0 1 7"/></>,
  temporary: <><path d="M6 3h12M6 21h12M8 3c0 5 2 6 4 9-2 3-4 4-4 9M16 3c0 5-2 6-4 9 2 3 4 4 4 9"/></>,
  user: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
  volume: <><path d="M5 10v4h4l5 4V6l-5 4H5Z"/><path d="M17 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/></>,
  warning: <><path d="M12 3 2.7 20h18.6L12 3Z"/><path d="M12 9v5M12 17.2v.1"/></>,
};

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return <svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{iconPaths[name]}</svg>;
}

export const sourceNames: Record<MusicSource, string> = { migu: '咪咕', netease: '网易云', qq: 'QQ', kuwo: '酷我' };
export const sourceColors: Record<MusicSource, string> = { migu: '#ff9d2e', netease: '#ff4d65', qq: '#38d9f3', kuwo: '#d757ff' };

function formatDuration(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '';
  const secondsValue = value > 10_000 ? value / 1000 : value;
  const minutes = Math.floor(secondsValue / 60);
  const seconds = Math.floor(secondsValue % 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function TrackRow({ item, active, pending, draggable, onPlay, onWarm, onFavorite, favorite, onAdd, onRemove, onDislike, reason, onDragStart, onDrop }: {
  item: Track; active?: boolean; pending?: boolean; draggable?: boolean; favorite?: boolean; reason?: string; onPlay: () => void; onWarm?: () => void; onFavorite: () => void; onAdd?: () => void; onRemove?: () => void; onDislike?: () => void; onDragStart?: () => void; onDrop?: () => void;
}) {
  return <div className={`track-row ${active ? 'active' : ''} ${pending ? 'pending' : ''}`} draggable={draggable} onDragStart={onDragStart} onDragOver={event => draggable && event.preventDefault()} onDrop={onDrop}>
    <button className="track-main" onClick={onPlay} onPointerEnter={onWarm} onFocus={onWarm} title="播放">
      <span className="track-source" style={{ '--source-color': sourceColors[item.source] } as React.CSSProperties}>{sourceNames[item.source].slice(0, 1)}</span>
      <span className="track-copy"><strong>{item.title}</strong><small>{item.artist}{item.album ? ` · ${item.album}` : ''}{reason ? ` · ${reason}` : ''}</small></span>
      {item.duration > 0 && <time>{formatDuration(item.duration)}</time>}
    </button>
    <div className="row-actions">
      <button className={favorite ? 'active' : ''} onClick={onFavorite} aria-label="收藏"><Icon name="heart" size={14}/></button>
      {onAdd && <button onClick={onAdd} aria-label="加入歌单"><Icon name="add" size={14}/></button>}
      {onDislike && <button onClick={onDislike} aria-label="不感兴趣"><Icon name="dislike" size={14}/></button>}
      {onRemove && <button onClick={onRemove} aria-label="移除"><Icon name="close" size={14}/></button>}
    </div>
  </div>;
}

interface DailyStageProps {
  activeTrackId?: string;
  date: string;
  favoriteIds: Set<string>;
  lang: 'zh' | 'en';
  loading: boolean;
  message?: string;
  pendingTrackId?: string;
  playing: boolean;
  tracks: RecommendedTrack[];
  username: string;
  onAdd: (track: RecommendedTrack) => void;
  onDislike: (track: RecommendedTrack) => void;
  onFavorite: (track: RecommendedTrack) => void;
  onPlay: (track: RecommendedTrack) => void;
  onPlayAll: () => void;
  onRegenerate: () => void;
  onReturnPlayer: () => void;
  onWarm: (track: RecommendedTrack) => void;
}

export function DailyStage(props: DailyStageProps) {
  const { activeTrackId, date, favoriteIds, lang, loading, message, pendingTrackId, playing, tracks, username } = props;
  const zh = lang === 'zh';
  const spotlight = tracks.slice(0, 3);
  const covers = tracks.filter(track => track.coverUrl).slice(0, 4);
  return <div className="daily-stage">
    <section className="daily-editorial">
      <div className="daily-copy">
        <span className="daily-kicker">DAILY ROTATION · {date}</span>
        <h2>{zh ? `${username}，今天听点不一样的` : `A different rotation for ${username}`}</h2>
        <p>{tracks.length ? (zh ? `${tracks.length} 首熟悉与探索交错的歌曲，为今天重新排序。` : `${tracks.length} familiar and exploratory tracks, reordered for today.`) : message || (zh ? '正在准备今天的声音…' : 'Preparing today’s sound…')}</p>
        <div className="daily-actions">
          <button className="btn primary" disabled={!tracks.length || loading} onClick={props.onPlayAll}><Icon name="play" size={15}/>{zh ? '播放全部' : 'Play all'}</button>
          {activeTrackId && <button className="btn stage-return" onClick={props.onReturnPlayer}><span className={playing ? 'playing-dot' : ''}/>{zh ? '正在播放' : 'Now playing'}</button>}
          <button className="btn icon-only" disabled={loading} onClick={props.onRegenerate} aria-label={zh ? '重新生成' : 'Regenerate'}><Icon name="sync" size={16}/></button>
        </div>
      </div>
      <div className="daily-collage" aria-label={zh ? '今日推荐封面' : 'Daily recommendation covers'}>
        {covers.length ? covers.map((track, index) => <img key={track.id} src={track.coverUrl || ''} alt="" style={{ '--cover-index': index } as React.CSSProperties}/>) : <div className="daily-cover-placeholder"><Icon name="sparkles" size={42}/></div>}
        <span className="daily-count">{String(tracks.length || 30).padStart(2, '0')}</span>
      </div>
    </section>
    <div className="daily-spotlight">
      {spotlight.map((track, index) => <button key={track.id} className={`daily-spotlight-card ${activeTrackId === track.id ? 'active' : ''}`} onClick={() => props.onPlay(track)} onPointerEnter={() => props.onWarm(track)} onFocus={() => props.onWarm(track)}>
        <span className="spotlight-rank">0{index + 1}</span>
        {track.coverUrl ? <img src={track.coverUrl} alt=""/> : <span className="spotlight-placeholder"><Icon name="music" size={24}/></span>}
        <span className="spotlight-copy"><strong>{track.title}</strong><small>{track.artist}</small><em>{track.reason}</em></span>
      </button>)}
    </div>
    {loading && <div className="daily-loading"><span/><strong>{zh ? '正在刷新今日推荐' : 'Refreshing today’s rotation'}</strong></div>}
    <div className="daily-mobile-list">
      {tracks.map(track => <TrackRow key={track.id} item={track} active={activeTrackId === track.id} pending={pendingTrackId === track.id} favorite={favoriteIds.has(track.id)} reason={track.reason} onPlay={() => props.onPlay(track)} onWarm={() => props.onWarm(track)} onFavorite={() => props.onFavorite(track)} onAdd={() => props.onAdd(track)} onDislike={() => props.onDislike(track)}/>) }
    </div>
  </div>;
}

export function MiniPlayer({ track, playing, resolving, onOpen, onToggle }: { track: Track; playing: boolean; resolving: boolean; onOpen: () => void; onToggle: () => void }) {
  return <div className="mobile-mini-player" role="group" aria-label="正在播放">
    <button className="mini-track" onClick={onOpen}>
      {track.coverUrl ? <img src={track.coverUrl} alt=""/> : <span><Icon name="music" size={18}/></span>}
      <span><strong>{track.title}</strong><small>{track.artist}</small></span>
    </button>
    <button className="mini-toggle" onClick={onToggle} aria-label={playing ? '暂停' : '播放'}>{resolving ? <span className="mini-loader"/> : <Icon name={playing ? 'pause' : 'play'} size={19}/>}</button>
  </div>;
}

export function MobileNavigation({ active, lang, playing, onChange }: { active: MobileSection; lang: 'zh' | 'en'; playing: boolean; onChange: (section: MobileSection) => void }) {
  const zh = lang === 'zh';
  const items: Array<{ section: MobileSection; icon: IconName; label: string }> = [
    { section: 'daily', icon: 'sparkles', label: zh ? '推荐' : 'Daily' },
    { section: 'search', icon: 'search', label: zh ? '搜索' : 'Search' },
    { section: 'player', icon: 'headphones', label: zh ? '播放' : 'Player' },
    { section: 'library', icon: 'library', label: zh ? '歌单' : 'Library' },
    { section: 'agent', icon: 'agent', label: zh ? '珍奇' : 'Zhenqi' },
  ];
  return <nav className="mobile-nav" aria-label={zh ? '主要导航' : 'Primary navigation'}>{items.map(item => <button key={item.section} className={`${active === item.section ? 'active' : ''} ${item.section === 'player' && playing ? 'is-playing' : ''}`} aria-current={active === item.section ? 'page' : undefined} onClick={() => onChange(item.section)}><span><Icon name={item.icon} size={20}/></span><small>{item.label}</small></button>)}</nav>;
}
