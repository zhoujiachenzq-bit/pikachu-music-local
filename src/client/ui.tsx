import type { MouseEvent } from 'react';
import { CaretDown, SpeakerHigh, Plus, UploadSimple, X, Prohibit, DownloadSimple, Headphones, Heart, ArrowSquareIn, Playlist, Waveform, MusicNotes, SkipForward, Palette, Pause, Play, SkipBack, Repeat, RepeatOnce, MagnifyingGlass, Shuffle, Sparkle, ArrowsClockwise, Warning } from '@phosphor-icons/react';
import { Grainient } from './Grainient';
import { TiltSurface } from './interactionEffects';
import type { ToneThemeId } from './visualTheme';
import type { MusicSource, RecommendedTrack, Track } from '../shared/types';
import type { MobileSection } from './visualState';

export type IconName = 'add' | 'collapse' | 'backup' | 'close' | 'dislike' | 'download' | 'headphones' | 'heart' | 'import' | 'library' | 'motion' | 'music' | 'next' | 'palette' | 'pause' | 'play' | 'previous' | 'repeat' | 'repeatOne' | 'restore' | 'search' | 'shuffle' | 'sparkles' | 'sync' | 'volume' | 'warning';

const iconComponents = {
  add: Plus, collapse: CaretDown, backup: UploadSimple, close: X, dislike: Prohibit,
  download: DownloadSimple, headphones: Headphones, heart: Heart,
  import: ArrowSquareIn, library: Playlist, motion: Waveform,
  music: MusicNotes, next: SkipForward, palette: Palette, pause: Pause, play: Play,
  previous: SkipBack, repeat: Repeat, repeatOne: RepeatOnce, restore: DownloadSimple,
  search: MagnifyingGlass,
  shuffle: Shuffle, sparkles: Sparkle, sync: ArrowsClockwise,
  volume: SpeakerHigh, warning: Warning,
} as const;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const Glyph = iconComponents[name];
  const solid = name === 'play' || name === 'pause' || name === 'previous' || name === 'next';
  return <Glyph className="ui-icon" size={size} weight={solid ? 'fill' : 'duotone'} aria-hidden="true"/>;
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
  item: Track; active?: boolean; pending?: boolean; draggable?: boolean; favorite?: boolean; reason?: string; onPlay: () => void; onWarm?: () => void; onFavorite: (event: MouseEvent<HTMLButtonElement>) => void; onAdd?: () => void; onRemove?: () => void; onDislike?: () => void; onDragStart?: () => void; onDrop?: () => void;
}) {
  return <div className={`track-row ${active ? 'active' : ''} ${pending ? 'pending' : ''}`} draggable={draggable} onDragStart={onDragStart} onDragOver={event => draggable && event.preventDefault()} onDrop={onDrop}>
    <button className="track-main" onClick={onPlay} onPointerEnter={onWarm} onFocus={onWarm} title="播放">
      <span className="track-source" style={{ '--source-color': sourceColors[item.source] } as React.CSSProperties}>{sourceNames[item.source].slice(0, 1)}</span>
      <span className="track-copy"><strong>{item.title}</strong><small>{item.artist}{item.album ? ` · ${item.album}` : ''}{reason ? ` · ${reason}` : ''}</small></span>
      {item.duration > 0 && <time>{formatDuration(item.duration)}</time>}
    </button>
    <div className="row-actions">
      <button className={favorite ? 'active' : ''} data-success-spark={!favorite} onClick={onFavorite} aria-label="收藏"><Icon name="heart" size={14}/></button>
      {onAdd && <button onClick={onAdd} aria-label="加入歌单"><Icon name="add" size={14}/></button>}
      {onDislike && <button onClick={onDislike} aria-label="不感兴趣"><Icon name="dislike" size={14}/></button>}
      {onRemove && <button onClick={onRemove} aria-label="移除"><Icon name="close" size={14}/></button>}
    </div>
  </div>;
}

interface DailyStageProps {
  theme: ToneThemeId;
  motionEnabled: boolean;
  visible: boolean;
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
  onFavorite: (track: RecommendedTrack, event: MouseEvent<HTMLButtonElement>) => void;
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
    <section className="daily-editorial has-grainient">
      <Grainient tone={props.theme} motionEnabled={props.motionEnabled} active={props.visible} className="daily-grainient"/>
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
        {covers.length ? covers.map(track => <span className="collage-cover" key={track.id}><TiltSurface className="collage-tilt" enabled={props.motionEnabled && props.visible} intensity={18}><img src={track.coverUrl || ''} alt="" draggable={false}/></TiltSurface></span>) : <div className="daily-cover-placeholder"><Icon name="sparkles" size={42}/></div>}
        <span className="daily-count">{String(tracks.length || 30).padStart(2, '0')}</span>
      </div>
    </section>
    <div className="daily-spotlight">
      {spotlight.map((track, index) => <button key={track.id} className={`daily-spotlight-card ${activeTrackId === track.id ? 'active' : ''}`} onClick={() => props.onPlay(track)} onPointerEnter={() => props.onWarm(track)} onFocus={() => props.onWarm(track)}>
        <span className="spotlight-rank">0{index + 1}</span>
        <TiltSurface className="spotlight-art rb-glare" enabled={props.motionEnabled && props.visible}>{track.coverUrl ? <img src={track.coverUrl} alt=""/> : <span className="spotlight-placeholder"><Icon name="music" size={24}/></span>}</TiltSurface>
        <span className="spotlight-copy"><strong>{track.title}</strong><small>{track.artist}</small><em>{track.reason}</em></span>
      </button>)}
    </div>
    {loading && <div className="daily-loading"><span/><strong>{zh ? '正在刷新今日推荐' : 'Refreshing today’s rotation'}</strong></div>}
    <div className="daily-mobile-list">
      {tracks.map(track => <TrackRow key={track.id} item={track} active={activeTrackId === track.id} pending={pendingTrackId === track.id} favorite={favoriteIds.has(track.id)} reason={track.reason} onPlay={() => props.onPlay(track)} onWarm={() => props.onWarm(track)} onFavorite={event => props.onFavorite(track, event)} onAdd={() => props.onAdd(track)} onDislike={() => props.onDislike(track)}/>) }
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
  ];
  return <nav className="mobile-nav" aria-label={zh ? '主要导航' : 'Primary navigation'}>{items.map(item => <button key={item.section} className={`${active === item.section ? 'active' : ''} ${item.section === 'player' && playing ? 'is-playing' : ''}`} aria-current={active === item.section ? 'page' : undefined} onClick={() => onChange(item.section)}><span><Icon name={item.icon} size={20}/></span><small>{item.label}</small></button>)}</nav>;
}
