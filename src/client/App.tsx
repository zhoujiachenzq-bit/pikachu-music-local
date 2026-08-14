import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, json } from './api';
import { estimateUntimedLyricTime, findActiveLyric, findUntimedLyricStart, lyricCenterOffset, parseLrc } from './lyrics';
import { installMediaSessionControls, syncMediaSession, updateMediaMetadata } from './mediaSession';
import { ListeningTracker, type ListeningContext } from './listeningTracker';
import { PlaybackCache } from './playerCache';
import { PlaybackQueue } from './playerQueue';
import { ImmersiveWorkspaceScene, PlayerAtmosphere } from './ImmersiveBackdrop';
import { TonePicker, ToneTransitionLayer, type ToneTransitionState } from './TonePicker';
import { DailyStage, Icon, MiniPlayer, MobileNavigation, TrackRow, sourceColors, sourceNames } from './ui';
import { deriveVisualPalette, mobileSectionForStage, shouldShowMiniPlayer, stageAfterRecommendationPlay, type MobileSection, type StageMode } from './visualState';
import { DEFAULT_VISUAL_PREFERENCES, TONE_THEMES, readVisualPreferences, resolveToneTheme, writeVisualPreferences, type ToneThemeId, type VisualPreferences } from './visualTheme';
import { SOURCES, type DailyRecommendation, type ImportJob, type MusicSource, type PlaylistDetail, type PlaylistSummary, type ResolvedTrack, type Track, type User } from '../shared/types';
import { canonicalTrackKey, normalizeTrackText } from '../shared/trackIdentity';

type Lang = 'zh' | 'en';
type Tab = 'daily' | 'results' | 'favorites' | 'playlists';
interface BeforeInstallPromptEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
const copy = {
  zh: {
    shortcuts: '快捷键：Space 播放/暂停 · ←/→ 跳转 · ↑/↓ 音量 · N/P 切歌 · F 收藏',
    searchTitle: '歌曲搜索', supports: '支持咪咕 / 网易云 / QQ / 酷我', placeholder: '输入歌名 / 歌手，回车搜索…', search: '搜索', each: '每个源加载', more: '加载更多',
    idle: '尚未搜索，试试输入“林俊杰”？', now: '正在播放', lyricFx: '点击歌词定位 · 炫酷霓虹', pick: '搜索并播放一首歌吧！', noTrack: '暂未选择歌曲',
    playlist: '播放列表', daily: '每日推荐', results: '搜索结果', favorites: '我的收藏', custom: '自建歌单', newList: '新建歌单', import: '导入歌单', backup: '备份', sync: '同步',
    emptyLyrics: '暂无歌词，试着播放一首支持歌词的歌曲。', empty: '这里还没有歌曲。', login: '登录', register: '注册', username: '用户名', password: '密码',
    createAccount: '创建本地账户', welcome: '欢迎回来', accountHint: '所有收藏与歌单只保存在这台电脑。', logout: '退出', settings: '账户设置', changePassword: '修改密码', deleteAccount: '删除账户',
    source: '音乐源', publicLink: '公开歌单链接或 ID', startImport: '开始导入', importing: '正在导入', close: '关闭', create: '创建', cancel: '取消', name: '歌单名称',
    add: '加入歌单', searchInList: '搜索歌单内歌曲…', exportData: '导出数据', restoreData: '恢复数据', footer: '本站仅作为学习演示，音乐版权归各平台与原作者所有。',
    noResults: '没有找到歌曲，音乐源可能暂时不可用。', failed: '操作失败', playingFallback: '正在使用替代音源', loadingTrack: '正在缓冲', listMode: '列表循环', loopMode: '单曲循环', shuffleMode: '随机播放', seekTo: '定位到', estimatedSeekTo: '估算定位到', findingTimedLyrics: '正在从其他音乐源查找精确时间轴…', exactLyricFound: '已补充精确时间轴', estimatedLyricHint: '未找到精确时间轴，将从第一句歌词开始估算位置', estimatedLyricToast: '该歌词无时间轴，已从第一句歌词开始估算定位', seeking: '正在定位', seekUnsupported: '当前音源暂不支持时间定位', returnToLyric: '回到当前歌词', installApp: '安装音乐小屋', generatingDaily: '正在生成今日 30 首…', notInterested: '不感兴趣', retryDaily: '重新生成', dailyHistory: '近 7 天', dailyStage: '今日轮播', backToPlayer: '返回正在播放', playAll: '播放全部'
  },
  en: {
    shortcuts: 'Shortcuts: Space play/pause · ←/→ seek · ↑/↓ volume · N/P track · F favorite',
    searchTitle: 'Song Search', supports: 'Migu / NetEase / QQ / Kuwo', placeholder: 'Song or artist, press Enter…', search: 'Search', each: 'Per source', more: 'Load more',
    idle: 'Search for something you love.', now: 'Now Playing', lyricFx: 'Click lyrics to seek · Neon glow', pick: 'Search and play a song!', noTrack: 'No track selected',
    playlist: 'Playlists', daily: 'Daily', results: 'Results', favorites: 'Favorites', custom: 'My Playlists', newList: 'Create', import: 'Import', backup: 'Backup', sync: 'Sync',
    emptyLyrics: 'No lyrics available for this track.', empty: 'Nothing here yet.', login: 'Sign in', register: 'Register', username: 'Username', password: 'Password',
    createAccount: 'Create local account', welcome: 'Welcome back', accountHint: 'Favorites and playlists stay on this computer.', logout: 'Sign out', settings: 'Account', changePassword: 'Change password', deleteAccount: 'Delete account',
    source: 'Source', publicLink: 'Public playlist URL or ID', startImport: 'Import', importing: 'Importing', close: 'Close', create: 'Create', cancel: 'Cancel', name: 'Playlist name',
    add: 'Add to playlist', searchInList: 'Search in playlist…', exportData: 'Export', restoreData: 'Restore', footer: 'For learning only. Music rights belong to their platforms and creators.',
    noResults: 'No tracks found. A source may be temporarily unavailable.', failed: 'Action failed', playingFallback: 'Using fallback source', loadingTrack: 'Buffering', listMode: 'List loop', loopMode: 'Repeat one', shuffleMode: 'Shuffle', seekTo: 'Seek to', estimatedSeekTo: 'Estimated seek to', findingTimedLyrics: 'Looking for an exact timeline from other sources…', exactLyricFound: 'Exact lyric timeline found', estimatedLyricHint: 'No exact timeline found; clicks use an estimated position', estimatedLyricToast: 'No lyric timeline; position was estimated from the line number', seeking: 'Seeking', seekUnsupported: 'This source does not currently support seeking', returnToLyric: 'Follow current lyric', installApp: 'Install Music Cottage', generatingDaily: 'Generating today’s 30 tracks…', notInterested: 'Not interested', retryDaily: 'Regenerate', dailyHistory: 'Last 7 days', dailyStage: 'Daily rotation', backToPlayer: 'Back to player', playAll: 'Play all'
  }
} as const;

function formatTime(value: number) {
  if (!Number.isFinite(value)) return '00:00'; const minutes = Math.floor(value / 60); const seconds = Math.floor(value % 60); return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function localDateKey(value = new Date()) {
  const offset = value.getTimezoneOffset() * 60_000; return new Date(value.getTime() - offset).toISOString().slice(0, 10);
}

function startsInMobileLayout() {
  return window.matchMedia('(max-width: 760px)').matches;
}

function normalizeTrack(value: Track): Track {
  return { ...value, id: value.id || `${value.source}:${value.sourceTrackId}`, coverUrl: value.coverUrl || null, sourceUrl: value.sourceUrl || null };
}

function waitForAudioReady(element: HTMLAudioElement, timeoutMs: number): Promise<void> {
  if (element.readyState >= 1) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error('音频地址暂时无法加载，请稍后重试。')); };
    const timer = window.setTimeout(() => { cleanup(); reject(new Error('音频加载超时，正在尝试刷新地址。')); }, timeoutMs);
    const cleanup = () => { window.clearTimeout(timer); element.removeEventListener('loadedmetadata', finish); element.removeEventListener('canplay', finish); element.removeEventListener('error', fail); };
    element.addEventListener('loadedmetadata', finish, { once: true }); element.addEventListener('canplay', finish, { once: true }); element.addEventListener('error', fail, { once: true });
  });
}

function disposeAudio(element: HTMLAudioElement) {
  element.pause(); element.removeAttribute('src'); element.load();
}

function AuthScreen({ onAuth }: { onAuth: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login'); const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [inviteCode, setInviteCode] = useState(''); const [registrationOpen, setRegistrationOpen] = useState(true); const [inviteRequired, setInviteRequired] = useState(false); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { api<{ registrationOpen: boolean; inviteRequired: boolean }>('/api/config').then(value => { setRegistrationOpen(value.registrationOpen); setInviteRequired(value.inviteRequired); }).catch(() => undefined); }, []);
  const submit = async (event: FormEvent) => { event.preventDefault(); setError(''); setBusy(true); try { const result = await api<{ user: User }>(`/api/auth/${mode}`, json('POST', { username, password, ...(mode === 'register' && inviteRequired ? { inviteCode } : {}) })); onAuth(result.user); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); } };
  return <main className="auth-shell">
    <div className="aurora aurora-one"/><div className="aurora aurora-two"/>
    <section className="auth-card panel">
      <div className="brand-mark"><img src="/pikachu.gif" alt="Pikachu"/></div>
      <div className="eyebrow">PIKACHU MUSIC</div><h1>{mode === 'login' ? copy.zh.welcome : copy.zh.createAccount}</h1><p>{copy.zh.accountHint}</p>
      <form onSubmit={submit}>
        <label>{copy.zh.username}<input autoFocus value={username} onChange={e => setUsername(e.target.value)} minLength={2} maxLength={24} autoComplete="username"/></label>
        <label>{copy.zh.password}<input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={8} maxLength={72} autoComplete={mode === 'login' ? 'current-password' : 'new-password'}/></label>
        {mode === 'register' && inviteRequired && <label>邀请码<input value={inviteCode} onChange={event => setInviteCode(event.target.value)} autoComplete="off"/></label>}
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="btn primary wide" disabled={busy}>{busy ? '…' : mode === 'login' ? copy.zh.login : copy.zh.register}</button>
      </form>
      {(mode === 'register' || registrationOpen) && <button className="text-button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>{mode === 'login' ? '没有账户？创建一个' : '已有账户？返回登录'}</button>}
    </section>
  </main>;
}

function Modal({ title, children, onClose, wide = false }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}><section className={`modal-card ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button onClick={onClose} aria-label="关闭">×</button></header>{children}</section></div>;
}

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined); const lang: Lang = user?.language || 'zh'; const t = copy[lang];
  const [query, setQuery] = useState(''); const [sources, setSources] = useState<MusicSource[]>([...SOURCES]); const [limit, setLimit] = useState(10); const [results, setResults] = useState<Track[]>([]); const [searching, setSearching] = useState(false); const [searchErrors, setSearchErrors] = useState<Record<string, string>>({});
  const [favorites, setFavorites] = useState<Track[]>([]); const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]); const [selectedPlaylist, setSelectedPlaylist] = useState<PlaylistDetail | null>(null); const [tab, setTab] = useState<Tab>(() => startsInMobileLayout() ? 'daily' : 'results'); const [playlistFilter, setPlaylistFilter] = useState('');
  const [daily, setDaily] = useState<DailyRecommendation | null>(null); const [dailyFallback, setDailyFallback] = useState<DailyRecommendation | null>(null); const [dailyHistory, setDailyHistory] = useState<DailyRecommendation[]>([]); const [dailyDate, setDailyDate] = useState(localDateKey()); const [dailyLoading, setDailyLoading] = useState(false); const [dailyRefresh, setDailyRefresh] = useState(0);
  const [current, setCurrent] = useState<Track | null>(null); const [pendingTrack, setPendingTrack] = useState<Track | null>(null); const [resolved, setResolved] = useState<ResolvedTrack | null>(null); const [playing, setPlaying] = useState(false); const [resolving, setResolving] = useState(false); const [currentTime, setCurrentTime] = useState(0); const [duration, setDuration] = useState(0); const [toast, setToast] = useState(''); const [lyricSeekTarget, setLyricSeekTarget] = useState<number | null>(null); const [lyricFollowing, setLyricFollowing] = useState(true); const [findingTimedLyricsFor, setFindingTimedLyricsFor] = useState<string | null>(null); const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [stageMode, setStageMode] = useState<StageMode>(() => startsInMobileLayout() ? 'daily' : 'player'); const [mobileSection, setMobileSection] = useState<MobileSection>('daily');
  const [visualPreferences, setVisualPreferences] = useState<VisualPreferences>({ ...DEFAULT_VISUAL_PREFERENCES }); const [previewTone, setPreviewTone] = useState<ToneThemeId | null>(null); const [toneTransition, setToneTransition] = useState<ToneTransitionState | null>(null);
  const [createOpen, setCreateOpen] = useState(false); const [newName, setNewName] = useState(''); const [importOpen, setImportOpen] = useState(false); const [importSource, setImportSource] = useState<MusicSource>('netease'); const [importInput, setImportInput] = useState(''); const [importJob, setImportJob] = useState<ImportJob | null>(null); const [accountOpen, setAccountOpen] = useState(false); const [addTrack, setAddTrack] = useState<Track | null>(null);
  const audio = useRef<HTMLAudioElement>(null); const lyricBox = useRef<HTMLDivElement>(null); const draggedTrack = useRef<string | null>(null); const activeRequest = useRef(0); const requestedTrack = useRef<Track | null>(null); const committedTrackId = useRef<string | null>(null); const recoveringTrackId = useRef<string | null>(null); const importStream = useRef<EventSource | null>(null); const importReconnectTimer = useRef<number | null>(null); const dailyPollTimer = useRef<number | null>(null); const handledDailyRefresh = useRef(0); const queueContext = useRef<ListeningContext>({ type: 'unknown' }); const playbackCache = useMemo(() => new PlaybackCache(window.localStorage), []); const playbackQueue = useRef(new PlaybackQueue()); const resolveRequests = useRef(new Map<string, Promise<ResolvedTrack>>()); const warmedAudio = useRef(new Map<string, { element: HTMLAudioElement; url: string; usedAt: number }>()); const timedLyricLookups = useRef(new Set<string>()); const pendingLyricSeek = useRef<number | null>(null); const pendingLyricLine = useRef<number | null>(null); const lyricSeekTimer = useRef<number | null>(null); const lyricSeekSequence = useRef(0);
  const toneMidpointTimer = useRef<number | null>(null); const toneFinishTimer = useRef<number | null>(null);
  const listeningTracker = useMemo(() => new ListeningTracker(payload => {
    void fetch('/api/listening-sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), keepalive: true }).catch(() => undefined);
  }), []);
  const lyrics = useMemo(() => parseLrc(resolved?.lyric || null), [resolved?.lyric]);
  const activeLyric = useMemo(() => findActiveLyric(lyrics, currentTime), [lyrics, currentTime]);
  const hasTimedLyrics = useMemo(() => lyrics.some(line => Number.isFinite(line.time)), [lyrics]);
  const untimedLyricStart = useMemo(() => findUntimedLyricStart(lyrics), [lyrics]);
  const favoriteIds = useMemo(() => new Set(favorites.map(item => item.id)), [favorites]);
  const displayedDaily = daily?.status === 'completed' ? daily : dailyFallback;
  const dailyTracks = displayedDaily?.tracks || [];

  const showToast = useCallback((message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2600); }, []);
  const refreshLibrary = useCallback(async () => {
    const [fav, lists] = await Promise.all([api<{ tracks: Track[] }>('/api/favorites'), api<{ playlists: PlaylistSummary[] }>('/api/playlists')]); setFavorites(fav.tracks); setPlaylists(lists.playlists);
  }, []);
  const centerLyricLine = useCallback((index: number, behavior: ScrollBehavior = 'smooth') => {
    const container = lyricBox.current; if (!container || index < 0) return;
    const target = container.querySelector<HTMLElement>(`[data-line="${index}"]`); if (!target) return;
    const top = lyricCenterOffset(target.offsetTop, target.offsetHeight, container.clientHeight, container.scrollHeight);
    container.scrollTo({ top, behavior });
  }, []);
  const centerActiveLyric = useCallback((behavior: ScrollBehavior = 'smooth') => centerLyricLine(pendingLyricLine.current ?? activeLyric, behavior), [activeLyric, centerLyricLine]);
  useEffect(() => { api<{ user: User | null }>('/api/auth/me').then(result => setUser(result.user)).catch(() => setUser(null)); }, []);
  useEffect(() => {
    if (!user) { setVisualPreferences({ ...DEFAULT_VISUAL_PREFERENCES }); setPreviewTone(null); return; }
    setVisualPreferences(readVisualPreferences(window.localStorage, user.id)); setPreviewTone(null);
  }, [user?.id]);
  useEffect(() => () => {
    if (toneMidpointTimer.current !== null) window.clearTimeout(toneMidpointTimer.current);
    if (toneFinishTimer.current !== null) window.clearTimeout(toneFinishTimer.current);
  }, []);
  useEffect(() => { document.title = user ? `${user.username}的音乐小屋` : '音乐小屋'; }, [user]);
  useEffect(() => {
    const mobile = window.matchMedia('(max-width: 760px)');
    const syncMobileStage = () => {
      if (!mobile.matches) return;
      setMobileSection(section => section === 'search' || section === 'library' ? section : mobileSectionForStage(stageMode));
    };
    syncMobileStage(); mobile.addEventListener('change', syncMobileStage);
    return () => mobile.removeEventListener('change', syncMobileStage);
  }, [stageMode]);
  useEffect(() => {
    const capturePrompt = (event: Event) => { event.preventDefault(); setInstallPrompt(event as BeforeInstallPromptEvent); };
    const installed = () => setInstallPrompt(null);
    window.addEventListener('beforeinstallprompt', capturePrompt); window.addEventListener('appinstalled', installed);
    return () => { window.removeEventListener('beforeinstallprompt', capturePrompt); window.removeEventListener('appinstalled', installed); };
  }, []);
  useEffect(() => {
    const timers = new Set<number>();
    const createRipple = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      const target = event.target.closest<HTMLElement>('button, .track-row, .source-grid label, .icon-upload, .search-box, .load-row, .search-mini-list, .now-card, .lyrics, .tabs, .playlist-toolbar, .playlist-content, .play-modes, .import-progress, .add-list, .account-card, .modal-card, .panel, .daily-editorial, .daily-spotlight-card, .mobile-mini-player, .mobile-nav, .tone-panel, .tone-card');
      if (!target || target.matches(':disabled')) return;
      const rect = target.getBoundingClientRect();
      const x = event.clientX - rect.left; const y = event.clientY - rect.top; const size = Math.max(rect.width, rect.height);
      const outer = document.createElement('span'); const inner = document.createElement('span');
      outer.className = 'ripple-circle'; inner.className = 'ripple-circle-inner';
      for (const ripple of [outer, inner]) { ripple.style.left = `${x}px`; ripple.style.top = `${y}px`; }
      outer.style.width = outer.style.height = `${size * 2}px`;
      inner.style.width = inner.style.height = `${size * 1.4}px`;
      target.append(outer, inner);
      const timer = window.setTimeout(() => { outer.remove(); inner.remove(); timers.delete(timer); }, 800);
      timers.add(timer);
    };
    document.addEventListener('pointerdown', createRipple);
    return () => { document.removeEventListener('pointerdown', createRipple); timers.forEach(window.clearTimeout); document.querySelectorAll('.ripple-circle, .ripple-circle-inner').forEach(node => node.remove()); };
  }, []);
  useEffect(() => { if (user) refreshLibrary().catch(() => undefined); }, [user, refreshLibrary]);
  useEffect(() => {
    if (!user || tab !== 'daily') return;
    let cancelled = false; const regenerate = dailyRefresh > handledDailyRefresh.current; handledDailyRefresh.current = dailyRefresh;
    const poll = async (force = false) => {
      try {
        setDailyLoading(true);
        const result = await api<{ daily: DailyRecommendation | null; fallback: DailyRecommendation | null }>(`/api/recommendations/daily?date=${dailyDate}${force ? '&regenerate=true' : ''}`);
        if (cancelled) return; setDaily(result.daily); setDailyFallback(result.fallback);
        if (result.daily?.status === 'completed') {
          setDailyLoading(false); const history = await api<{ history: DailyRecommendation[] }>('/api/recommendations/history'); if (!cancelled) setDailyHistory(history.history); return;
        }
        dailyPollTimer.current = window.setTimeout(() => { void poll(false); }, 2000);
      } catch (error) { if (!cancelled) { setDailyLoading(false); showToast(error instanceof Error ? error.message : t.failed); } }
    };
    void poll(regenerate);
    return () => { cancelled = true; if (dailyPollTimer.current !== null) window.clearTimeout(dailyPollTimer.current); dailyPollTimer.current = null; };
  }, [dailyDate, dailyRefresh, showToast, t.failed, tab, user?.id]);
  useEffect(() => {
    if (!current || !resolved || hasTimedLyrics || timedLyricLookups.current.has(current.id)) return;
    const trackId = current.id; let cancelled = false; timedLyricLookups.current.add(trackId); setFindingTimedLyricsFor(trackId);
    api<{ lyric: string | null; actualSource: MusicSource; exact: boolean }>(`/api/tracks/${encodeURIComponent(trackId)}/lyrics`)
      .then(result => {
        if (cancelled || !result.exact || !result.lyric || !parseLrc(result.lyric).some(line => Number.isFinite(line.time))) return;
        setResolved(previous => {
          if (!previous || previous.id !== trackId) return previous;
          const next = { ...previous, lyric: result.lyric }; playbackCache.rememberResolved(next); return next;
        });
        showToast(`${sourceNames[result.actualSource]} · ${t.exactLyricFound}`);
      })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setFindingTimedLyricsFor(previous => previous === trackId ? null : previous); });
    return () => { cancelled = true; };
  }, [current, resolved, lyrics, hasTimedLyrics, playbackCache, showToast, t.exactLyricFound]);
  useEffect(() => { if (!selectedPlaylist) return; api<{ playlist: PlaylistDetail }>(`/api/playlists/${encodeURIComponent(selectedPlaylist.id)}`).then(v => setSelectedPlaylist(v.playlist)).catch(() => setSelectedPlaylist(null)); }, [playlists]);
  useEffect(() => { if (lyricFollowing) centerActiveLyric(); }, [activeLyric, centerActiveLyric, lyricFollowing]);
  useEffect(() => {
    if (!user || !window.matchMedia('(max-width: 760px)').matches) return;
    const container = document.querySelector<HTMLElement>(`[data-mobile-section="${mobileSection}"][data-mobile-active="true"]`);
    if (!container) return;
    const key = `pikachu:mobile-scroll:${user.id}:${mobileSection}`; let restoring = true; let saveTimer = 0;
    const save = () => window.localStorage.setItem(key, JSON.stringify({ y: container.scrollTop, updatedAt: Date.now() }));
    const onScroll = () => { if (restoring) return; window.clearTimeout(saveTimer); saveTimer = window.setTimeout(save, 120); };
    requestAnimationFrame(() => requestAnimationFrame(() => {
      let target = 0;
      try { const stored = JSON.parse(window.localStorage.getItem(key) || 'null') as { y?: number } | null; if (Number.isFinite(stored?.y)) target = Number(stored?.y); } catch { /* Ignore malformed local state. */ }
      container.scrollTo({ top: Math.min(Math.max(0, target), Math.max(0, container.scrollHeight - container.clientHeight)), behavior: 'auto' }); restoring = false;
    }));
    container.addEventListener('scroll', onScroll, { passive: true }); window.addEventListener('pagehide', save);
    return () => { window.clearTimeout(saveTimer); save(); container.removeEventListener('scroll', onScroll); window.removeEventListener('pagehide', save); };
  }, [mobileSection, stageMode, user?.id]);
  useEffect(() => () => {
    if (lyricSeekTimer.current !== null) window.clearTimeout(lyricSeekTimer.current);
    if (importReconnectTimer.current !== null) window.clearTimeout(importReconnectTimer.current);
    if (dailyPollTimer.current !== null) window.clearTimeout(dailyPollTimer.current);
    importStream.current?.close(); importStream.current = null;
    warmedAudio.current.forEach(entry => disposeAudio(entry.element)); warmedAudio.current.clear();
  }, []);
  useEffect(() => {
    const finish = () => listeningTracker.finish('pagehide');
    window.addEventListener('pagehide', finish); return () => { window.removeEventListener('pagehide', finish); finish(); };
  }, [listeningTracker, user?.id]);

  const doSearch = async (append = false) => {
    if (!query.trim() || !sources.length) return; setSearching(true); if (!append) { setResults([]); setSearchErrors({}); }
    try { const size = append ? Math.min(30, limit + 10) : limit; const data = await api<{ tracks: Track[]; errors: Record<string, string> }>(`/api/search?q=${encodeURIComponent(query)}&sources=${sources.join(',')}&limit=${size}`); setResults(data.tracks.map(normalizeTrack)); setSearchErrors(data.errors); if (append) setLimit(size); setTab('results'); }
    catch (error) { showToast(error instanceof Error ? error.message : t.failed); } finally { setSearching(false); }
  };

  const switchMobileSection = useCallback((section: MobileSection) => {
    setMobileSection(section);
    if (section === 'daily') {
      setDailyDate(localDateKey()); setTab('daily'); setStageMode('daily');
    } else if (section === 'player') {
      setStageMode('player');
    } else if (section === 'search') {
      setTab('results');
    } else if (tab !== 'favorites' && tab !== 'playlists') {
      setTab('favorites');
    }
  }, [tab]);

  const queue = useMemo(() => tab === 'daily' ? dailyTracks : tab === 'favorites' ? favorites : tab === 'playlists' && selectedPlaylist ? selectedPlaylist.tracks.filter(item => !item.excluded) : results, [tab, dailyTracks, favorites, selectedPlaylist, results]);
  const resolveTrack = useCallback((item: Track, refresh = false) => {
    const normalized = normalizeTrack(item); const requestKey = refresh ? `${normalized.id}:refresh` : normalized.id;
    if (!refresh) { const cached = playbackCache.getResolved(normalized.id); if (cached) return Promise.resolve(cached); }
    else playbackCache.forgetResolved(normalized.id);
    const active = resolveRequests.current.get(requestKey); if (active) return active;
    const request = api<{ track: ResolvedTrack }>(`/api/tracks/${encodeURIComponent(normalized.id)}/resolve`, json('POST', { track: normalized, refresh }))
      .then(data => { const next = playbackCache.withRememberedLyric({ ...data.track, id: normalized.id }); playbackCache.rememberResolved(next); return next; })
      .finally(() => { if (resolveRequests.current.get(requestKey) === request) resolveRequests.current.delete(requestKey); });
    resolveRequests.current.set(requestKey, request); return request;
  }, [playbackCache]);
  const warmTrack = useCallback(async (item: Track) => {
    const normalized = normalizeTrack(item); const existing = warmedAudio.current.get(normalized.id);
    if (existing) { existing.usedAt = Date.now(); return; }
    if (resolveRequests.current.size >= 2 && !resolveRequests.current.has(normalized.id)) return;
    try {
      const next = await resolveTrack(normalized); if (warmedAudio.current.has(normalized.id)) return;
      const element = new Audio(); element.preload = 'auto'; element.src = next.audioUrl;
      const entry = { element, url: next.audioUrl, usedAt: Date.now() }; warmedAudio.current.set(normalized.id, entry);
      if (warmedAudio.current.size > 4) {
        const oldest = [...warmedAudio.current.entries()].filter(([id]) => id !== normalized.id).sort((a, b) => a[1].usedAt - b[1].usedAt)[0];
        if (oldest) { warmedAudio.current.delete(oldest[0]); disposeAudio(oldest[1].element); }
      }
      element.addEventListener('error', () => { if (warmedAudio.current.get(normalized.id) === entry) { warmedAudio.current.delete(normalized.id); disposeAudio(element); } }, { once: true });
      element.load();
    } catch { /* Preloading is best-effort and must never interrupt normal use. */ }
  }, [resolveTrack]);
  const playTrack = useCallback(async (item: Track) => {
    const requestId = ++activeRequest.current; lyricSeekSequence.current += 1; pendingLyricSeek.current = null; pendingLyricLine.current = null; setLyricSeekTarget(null); if (lyricSeekTimer.current !== null) window.clearTimeout(lyricSeekTimer.current); lyricSeekTimer.current = null;
    const inFlightAudio = audio.current; if (inFlightAudio && inFlightAudio.dataset.requestId && inFlightAudio.dataset.trackId !== committedTrackId.current) inFlightAudio.pause();
    const normalized = normalizeTrack(item); requestedTrack.current = normalized; setPendingTrack(normalized); setResolving(true);
    try {
      let next = await resolveTrack(normalized); if (requestId !== activeRequest.current) return false;
      const element = audio.current; if (!element) throw new Error('播放器尚未准备好。');
      const previous = { url: element.currentSrc, time: element.currentTime, shouldPlay: !element.paused, trackId: committedTrackId.current };
      const restorePrevious = async () => {
        if (!previous.url) { element.removeAttribute('src'); element.load(); return; }
        element.src = previous.url; element.dataset.requestId = ''; element.dataset.trackId = previous.trackId || ''; const ready = waitForAudioReady(element, 4000); element.load(); await ready.catch(() => undefined);
        try { element.currentTime = previous.time; } catch { /* The restored source may not be seekable yet. */ }
        if (previous.shouldPlay) await element.play().catch(() => undefined);
      };
      const activate = async (candidate: ResolvedTrack) => {
        element.pause(); setPlaying(false); element.preload = 'auto'; element.dataset.requestId = String(requestId); element.dataset.trackId = ''; element.src = candidate.audioUrl;
        const ready = waitForAudioReady(element, 8000); element.load();
        await ready;
        if (requestId !== activeRequest.current) { if (element.dataset.requestId === String(requestId)) await restorePrevious(); return false; }
        element.volume = user?.volume ?? 0.8; element.loop = user?.playMode === 'loop'; element.dataset.trackId = normalized.id; committedTrackId.current = normalized.id;
        listeningTracker.start(normalized.id, queueContext.current, candidate.actualSource, Number.isFinite(element.duration) ? element.duration * 1000 : normalized.duration);
        setCurrent(normalized); setResolved(candidate); setCurrentTime(0); setDuration(Number.isFinite(element.duration) ? element.duration : 0); setPendingTrack(null); requestedTrack.current = null; setResolving(false); setPlaying(false); setLyricFollowing(true);
        const playAttempt = element.play().then(() => ({ ok: true as const })).catch(error => ({ ok: false as const, error }));
        void playAttempt.then(result => { if (requestId !== activeRequest.current) return; if (result.ok) { setPlaying(true); return; } if ((result.error as DOMException)?.name !== 'AbortError') showToast('歌曲已加载，点击播放按钮即可继续。'); });
        return true;
      };

      try { if (await activate(next)) return true; }
      catch {
        playbackCache.forgetResolved(normalized.id); const expired = warmedAudio.current.get(normalized.id); if (expired) { warmedAudio.current.delete(normalized.id); disposeAudio(expired.element); }
        next = await resolveTrack(normalized, true); if (requestId !== activeRequest.current) return false;
        try { if (await activate(next)) return true; }
        catch (error) { if (requestId === activeRequest.current && element.dataset.requestId === String(requestId)) await restorePrevious(); throw error; }
      }
      if (requestId === activeRequest.current && element.dataset.requestId === String(requestId)) await restorePrevious();
      return false;
    }
    catch (error) { if (requestId === activeRequest.current) showToast(error instanceof Error ? error.message : t.failed); return false; }
    finally { if (requestId === activeRequest.current) { setResolving(false); setPendingTrack(null); requestedTrack.current = null; } }
  }, [listeningTracker, resolveTrack, showToast, t.failed, user?.playMode, user?.volume]);
  const playFromQueue = useCallback((item: Track, sourceQueue: Track[], context?: ListeningContext) => {
    queueContext.current = context || (sourceQueue === favorites ? { type: 'favorites' } : sourceQueue === results ? { type: 'search', id: query.trim() || null } : selectedPlaylist ? { type: 'playlist', id: selectedPlaylist.id } : { type: 'unknown' });
    playbackQueue.current.reset(sourceQueue.map(normalizeTrack), item.id); return playTrack(item);
  }, [favorites, playTrack, query, results, selectedPlaylist]);
  const playRelative = useCallback(async (direction: 1 | -1) => {
    if (!playbackQueue.current.size && queue.length) playbackQueue.current.reset(queue.map(normalizeTrack), (requestedTrack.current || current || queue[0]).id);
    const attempts = playbackQueue.current.size; if (!attempts) return;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const next = playbackQueue.current.move(direction, user?.playMode || 'list'); if (!next) return;
      if (await playTrack(next)) return;
      playbackQueue.current.drop(next.id);
    }
  }, [queue, current, user?.playMode, playTrack]);
  const recoverPlayback = useCallback(async (element: HTMLAudioElement) => {
    const track = current;
    if (!track || element.dataset.trackId !== committedTrackId.current || recoveringTrackId.current === track.id) return;
    const failedAt = Number.isFinite(element.currentTime) ? element.currentTime : currentTime;
    recoveringTrackId.current = track.id; setResolving(true);
    try {
      playbackCache.forgetResolved(track.id);
      const refreshed = await resolveTrack(track, true);
      if (committedTrackId.current !== track.id || current?.id !== track.id) return;
      element.pause(); element.dataset.trackId = ''; element.src = refreshed.audioUrl;
      const ready = waitForAudioReady(element, 8000); element.load(); await ready;
      if (committedTrackId.current !== track.id) return;
      element.dataset.trackId = track.id;
      if (failedAt > 0 && Number.isFinite(element.duration)) {
        try { element.currentTime = Math.min(failedAt, Math.max(0, element.duration - 0.25)); } catch { /* Some live URLs are not seekable. */ }
      }
      setResolved(refreshed); listeningTracker.setSource(refreshed.actualSource); setCurrentTime(element.currentTime || failedAt); setDuration(Number.isFinite(element.duration) ? element.duration : 0);
      await element.play(); showToast('播放地址已刷新，已从中断位置继续。');
    } catch (error) {
      if (committedTrackId.current === track.id) {
        listeningTracker.setError(error instanceof Error ? error.name || 'PLAYBACK_ERROR' : 'PLAYBACK_ERROR'); listeningTracker.finish('error');
        showToast(error instanceof Error ? `当前歌曲恢复失败：${error.message}` : '当前歌曲恢复失败，正在跳过。');
        void playRelative(1);
      }
    } finally {
      if (recoveringTrackId.current === track.id) recoveringTrackId.current = null;
      setResolving(false);
    }
  }, [current, currentTime, listeningTracker, playbackCache, playRelative, resolveTrack, showToast]);
  const togglePlay = useCallback(() => { const element = audio.current; if (!element) return; if (!current && queue[0]) return void playFromQueue(queue[0], queue); if (element.paused) void element.play(); else element.pause(); }, [current, queue, playFromQueue]);
  useEffect(() => {
    const candidates = [playbackQueue.current.peek(1, user?.playMode || 'list'), playbackQueue.current.peek(-1, user?.playMode || 'list')];
    candidates.filter((item): item is Track => Boolean(item && item.id !== current?.id)).forEach(item => { void warmTrack(item); });
  }, [current, user?.playMode, warmTrack]);
  useEffect(() => { if (audio.current) audio.current.loop = user?.playMode === 'loop'; }, [user?.playMode]);
  useEffect(() => updateMediaMetadata(current, resolved), [current, resolved]);
  useEffect(() => installMediaSessionControls({
    play: () => { if (audio.current?.paused) void audio.current.play(); },
    pause: () => audio.current?.pause(),
    next: () => { void playRelative(1); }, previous: () => { void playRelative(-1); },
    seek: time => { if (audio.current) audio.current.currentTime = Math.min(Math.max(0, time), Number.isFinite(audio.current.duration) ? audio.current.duration : time); },
    seekBy: offset => { if (audio.current) audio.current.currentTime = Math.max(0, audio.current.currentTime + offset); },
  }), [playRelative]);
  useEffect(() => {
    let frame = 0; let lastUpdate = 0;
    const sync = () => {
      const element = audio.current; if (!element || element.dataset.trackId !== committedTrackId.current) return;
      if (pendingLyricSeek.current === null) setCurrentTime(element.currentTime);
      if (Number.isFinite(element.duration)) setDuration(element.duration);
      setPlaying(!element.paused && !element.ended); syncMediaSession(element, !element.paused && !element.ended);
    };
    const tick = (stamp: number) => { frame = 0; if (stamp - lastUpdate >= 200) { lastUpdate = stamp; sync(); } if (playing && document.visibilityState === 'visible') frame = requestAnimationFrame(tick); };
    const visibility = () => { if (frame) { cancelAnimationFrame(frame); frame = 0; } sync(); if (document.visibilityState === 'visible' && playing) frame = requestAnimationFrame(tick); };
    sync(); if (playing && document.visibilityState === 'visible') frame = requestAnimationFrame(tick);
    document.addEventListener('visibilitychange', visibility); window.addEventListener('focus', sync);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('focus', sync); };
  }, [playing]);
  const applyPendingLyricSeek = useCallback((element: HTMLAudioElement) => {
    const requested = pendingLyricSeek.current; if (requested === null || element.readyState < 1) return;
    const target = Number.isFinite(element.duration) && element.duration > 0 ? Math.min(requested, Math.max(0, element.duration - .05)) : requested;
    if (target !== requested) { pendingLyricSeek.current = target; setLyricSeekTarget(target); }
    try { element.currentTime = target; }
    catch {
      try { const fastSeek = (element as HTMLAudioElement & { fastSeek?: (value: number) => void }).fastSeek; if (typeof fastSeek === 'function') fastSeek.call(element, target); }
      catch { /* loadedmetadata/canplay will retry while the target remains pending */ }
    }
  }, []);
  const finishLyricSeek = useCallback((element: HTMLAudioElement) => {
    const target = pendingLyricSeek.current; if (target === null || Math.abs(element.currentTime - target) > 1.5) return false;
    pendingLyricSeek.current = null; pendingLyricLine.current = null; setLyricSeekTarget(null); if (lyricSeekTimer.current !== null) window.clearTimeout(lyricSeekTimer.current); lyricSeekTimer.current = null; setCurrentTime(element.currentTime); return true;
  }, []);
  const seekToLyric = (time: number, index: number, estimated = false) => {
    const element = audio.current; if (!Number.isFinite(time) || !element || !element.currentSrc) return;
    const sequence = ++lyricSeekSequence.current; pendingLyricSeek.current = time; pendingLyricLine.current = index; centerLyricLine(index, 'auto'); setLyricSeekTarget(time); setCurrentTime(time); setLyricFollowing(true); applyPendingLyricSeek(element);
    if (estimated) showToast(t.estimatedLyricToast);
    if (lyricSeekTimer.current !== null) window.clearTimeout(lyricSeekTimer.current);
    lyricSeekTimer.current = window.setTimeout(() => { const active = audio.current; if (sequence !== lyricSeekSequence.current || !active || pendingLyricSeek.current === null) return; applyPendingLyricSeek(active); window.setTimeout(() => { const latest = audio.current; if (sequence !== lyricSeekSequence.current || !latest || pendingLyricSeek.current === null || finishLyricSeek(latest)) return; pendingLyricSeek.current = null; pendingLyricLine.current = null; setLyricSeekTarget(null); setCurrentTime(latest.currentTime); showToast(t.seekUnsupported); }, 900); }, 11_000);
  };

  const toggleFavorite = async (item: Track) => { try { if (favoriteIds.has(item.id)) await api(`/api/favorites/${encodeURIComponent(item.id)}`, json('DELETE')); else await api('/api/favorites', json('POST', item)); await refreshLibrary(); showToast(favoriteIds.has(item.id) ? '已取消收藏' : '已添加到收藏'); } catch (error) { showToast(error instanceof Error ? error.message : t.failed); } };
  const setPreference = async (patch: Partial<Pick<User, 'language' | 'volume' | 'playMode'>>) => { if (!user) return; const previous = user; setUser({ ...user, ...patch }); try { const result = await api<{ user: User }>('/api/auth/preferences', json('PATCH', patch)); setUser(result.user); } catch (error) { setUser(previous); showToast(error instanceof Error ? error.message : t.failed); } };
  const dislikeRecommendation = async (item: Track) => {
    const canonicalKey = item.canonicalKey || canonicalTrackKey(item.title, item.artist);
    try {
      await api('/api/recommendations/feedback', json('POST', { canonicalKey, action: 'not_interested', artistKey: normalizeTrackText(item.artist) }));
      const remove = (value: DailyRecommendation | null) => value ? { ...value, tracks: value.tracks.filter(track => (track.canonicalKey || canonicalTrackKey(track.title, track.artist)) !== canonicalKey) } : value;
      setDaily(remove); setDailyFallback(remove); showToast(t.notInterested);
    } catch (error) { showToast(error instanceof Error ? error.message : t.failed); }
  };
  const installApp = async () => { if (!installPrompt) return; await installPrompt.prompt(); const choice = await installPrompt.userChoice; if (choice.outcome === 'accepted') setInstallPrompt(null); };
  const saveVisualPreferences = useCallback((next: VisualPreferences) => {
    setVisualPreferences(next); if (user) writeVisualPreferences(window.localStorage, user.id, next);
  }, [user?.id]);
  const commitToneTheme = useCallback((theme: ToneThemeId, origin: { x: number; y: number }) => {
    setPreviewTone(null); if (theme === visualPreferences.theme) return;
    if (toneMidpointTimer.current !== null) window.clearTimeout(toneMidpointTimer.current);
    if (toneFinishTimer.current !== null) window.clearTimeout(toneFinishTimer.current);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; const mobile = window.matchMedia('(max-width: 760px)').matches;
    const duration = reduced ? 120 : mobile ? 250 : 460; const midpoint = reduced ? 0 : mobile ? 92 : 168;
    const next = { ...visualPreferences, theme } as VisualPreferences;
    setToneTransition({ id: Date.now(), x: origin.x, y: origin.y, color: TONE_THEMES[theme].canvas, duration, reduced });
    toneMidpointTimer.current = window.setTimeout(() => saveVisualPreferences(next), midpoint);
    toneFinishTimer.current = window.setTimeout(() => setToneTransition(null), duration + 40);
  }, [saveVisualPreferences, visualPreferences]);
  const setMotionEnabled = useCallback((motionEnabled: boolean) => saveVisualPreferences({ ...visualPreferences, motionEnabled }), [saveVisualPreferences, visualPreferences]);

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((event.target as HTMLElement)?.tagName)) return;
      if (event.code === 'Space') { event.preventDefault(); togglePlay(); } else if (event.key === 'ArrowRight' && audio.current) audio.current.currentTime += 5; else if (event.key === 'ArrowLeft' && audio.current) audio.current.currentTime -= 5;
      else if (event.key === 'ArrowUp' && audio.current) { event.preventDefault(); audio.current.volume = Math.min(1, audio.current.volume + .05); void setPreference({ volume: audio.current.volume }); }
      else if (event.key === 'ArrowDown' && audio.current) { event.preventDefault(); audio.current.volume = Math.max(0, audio.current.volume - .05); void setPreference({ volume: audio.current.volume }); }
      else if (event.key.toLowerCase() === 'n') playRelative(1); else if (event.key.toLowerCase() === 'p') playRelative(-1); else if (event.key.toLowerCase() === 'f' && current) void toggleFavorite(current);
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, [togglePlay, playRelative, current, favoriteIds]);

  const createPlaylist = async () => { if (!newName.trim()) return; try { const result = await api<{ playlist: PlaylistSummary }>('/api/playlists', json('POST', { name: newName })); setCreateOpen(false); setNewName(''); await refreshLibrary(); setTab('playlists'); const detail = await api<{ playlist: PlaylistDetail }>(`/api/playlists/${result.playlist.id}`); setSelectedPlaylist(detail.playlist); } catch (error) { showToast(error instanceof Error ? error.message : t.failed); } };
  const openPlaylist = async (item: PlaylistSummary) => { setTab('playlists'); try { const result = await api<{ playlist: PlaylistDetail }>(`/api/playlists/${item.id}`); setSelectedPlaylist(result.playlist); } catch (error) { showToast(error instanceof Error ? error.message : t.failed); } };
  const addToPlaylist = async (playlistId: string) => { if (!addTrack) return; try { await api(`/api/playlists/${playlistId}/tracks`, json('POST', addTrack)); setAddTrack(null); await refreshLibrary(); showToast('已加入歌单'); } catch (error) { showToast(error instanceof Error ? error.message : t.failed); } };
  const removeFromPlaylist = async (trackId: string) => { if (!selectedPlaylist) return; await api(`/api/playlists/${selectedPlaylist.id}/tracks/${encodeURIComponent(trackId)}`, json('DELETE')); const result = await api<{ playlist: PlaylistDetail }>(`/api/playlists/${selectedPlaylist.id}`); setSelectedPlaylist(result.playlist); await refreshLibrary(); };
  const reorder = async (targetId: string) => { if (!selectedPlaylist || !draggedTrack.current || targetId === draggedTrack.current) return; const ids = selectedPlaylist.tracks.filter(i => !i.excluded).map(i => i.id); const from = ids.indexOf(draggedTrack.current); const to = ids.indexOf(targetId); ids.splice(to, 0, ids.splice(from, 1)[0]); const result = await api<{ playlist: PlaylistDetail }>(`/api/playlists/${selectedPlaylist.id}/reorder`, json('POST', { trackIds: ids })); setSelectedPlaylist(result.playlist); };

  function watchImport(job: ImportJob, attempt = 0) {
    setImportJob(job); importStream.current?.close();
    if (importReconnectTimer.current !== null) window.clearTimeout(importReconnectTimer.current);
    const finish = async (next: ImportJob) => {
      setImportJob(next);
      if (!['completed', 'partial', 'failed'].includes(next.status)) return false;
      importStream.current?.close(); importStream.current = null;
      if (next.status !== 'failed') {
        await refreshLibrary();
        if (next.playlistId) { const detail = await api<{ playlist: PlaylistDetail }>(`/api/playlists/${next.playlistId}`); setSelectedPlaylist(detail.playlist); setTab('playlists'); }
      }
      return true;
    };
    const stream = new EventSource(`/api/imports/${job.id}/events`); importStream.current = stream;
    stream.onmessage = event => { const next = JSON.parse(event.data) as ImportJob; void finish(next); };
    stream.onerror = () => {
      stream.close(); if (importStream.current === stream) importStream.current = null;
      const delay = Math.min(8000, 750 * (2 ** Math.min(attempt, 4)));
      importReconnectTimer.current = window.setTimeout(async () => {
        try { const result = await api<{ job: ImportJob }>(`/api/imports/${job.id}`); if (!(await finish(result.job))) watchImport(result.job, attempt + 1); }
        catch { watchImport(job, attempt + 1); }
      }, delay);
    };
  }
  const startImport = async () => { try { const source = /^\d+$/.test(importInput.trim()) ? importSource : undefined; const result = await api<{ job: ImportJob }>('/api/imports', json('POST', { input: importInput, source })); watchImport(result.job); } catch (error) { showToast(error instanceof Error ? error.message : t.failed); } };
  const syncPlaylist = async () => { if (!selectedPlaylist) return; try { const result = await api<{ job: ImportJob }>(`/api/playlists/${selectedPlaylist.id}/sync`, json('POST')); setImportOpen(true); watchImport(result.job); } catch (error) { showToast(error instanceof Error ? error.message : t.failed); } };

  const exportBackup = async () => { const response = await fetch('/api/backup/export'); if (!response.ok) return showToast(t.failed); const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `pikachu-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url); };
  const restoreBackup = async (file: File) => { try { const data = JSON.parse(await file.text()); const preview = await api<{ preview: { favorites: number; playlists: number; tracks: number } }>('/api/backup/restore', json('POST', { mode: 'preview', data })); if (!window.confirm(`将合并 ${preview.preview.favorites} 个收藏、${preview.preview.playlists} 个歌单、${preview.preview.tracks} 首歌曲。继续？`)) return; await api('/api/backup/restore', json('POST', { mode: 'merge', data })); await refreshLibrary(); showToast('数据恢复完成'); } catch (error) { showToast(error instanceof Error ? error.message : t.failed); } };

  if (user === undefined) return <div className="loading-screen"><div className="loader">⚡</div></div>;
  if (!user) return <AuthScreen onAuth={setUser}/>;

  const visiblePlaylistTracks = selectedPlaylist?.tracks.filter(item => !item.excluded && `${item.title} ${item.artist}`.toLowerCase().includes(playlistFilter.toLowerCase())) || [];
  const displayTrack = current && resolved ? { ...current, title: resolved.title || current.title, artist: resolved.artist || current.artist, album: resolved.album || current.album, coverUrl: resolved.coverUrl || current.coverUrl } : current;
  const modeLabel = user.playMode === 'list' ? t.listMode : user.playMode === 'loop' ? t.loopMode : t.shuffleMode;
  const sceneTrack = stageMode === 'daily' ? dailyTracks[0] : displayTrack;
  const activeTone = resolveToneTheme(visualPreferences.theme, previewTone);
  const visualPalette = deriveVisualPalette(sceneTrack, activeTone);
  const stageProgress = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0;
  const showMobileMini = shouldShowMiniPlayer(mobileSection, Boolean(current));
  return <div className={`app-shell mobile-section-${mobileSection} ${showMobileMini ? 'has-mobile-mini' : ''} ${previewTone ? 'tone-previewing' : ''} ${visualPreferences.motionEnabled ? 'motion-on' : 'motion-off'}`} data-tone={activeTone} style={{ '--track-accent': visualPalette.secondary, '--track-glow': visualPalette.glow, '--scene-theme-accent': TONE_THEMES[activeTone].sceneAccent, '--scene-theme-glow': TONE_THEMES[activeTone].sceneGlow } as React.CSSProperties}>
    <ImmersiveWorkspaceScene theme={activeTone} motionEnabled={visualPreferences.motionEnabled} palette={visualPalette} playing={playing} progress={stageProgress} stage={stageMode}/>
    <div className="particle-field" aria-hidden="true">{Array.from({ length: 26 }, (_, i) => <i key={i} style={{ '--x': `${(i * 37) % 100}%`, '--y': `${(i * 61) % 100}%`, '--d': `${5 + (i % 7)}s`, '--s': `${2 + (i % 4)}px` } as React.CSSProperties}/>)}</div>
    <header className="topbar panel">
      <div className="brand"><div className="logo-ring"><img src="/pikachu.gif" alt="Pikachu"/></div><div><span className="brand-kicker">PIKACHU MUSIC</span><h1>{lang === 'zh' ? `${user.username}的音乐小屋` : `${user.username}'s Music Cottage`}</h1></div></div>
      <div className="header-actions"><div className="language"><button className={lang === 'zh' ? 'active' : ''} onClick={() => void setPreference({ language: 'zh' })}>中</button><button className={lang === 'en' ? 'active' : ''} onClick={() => void setPreference({ language: 'en' })}>EN</button></div><TonePicker activeTheme={activeTone} committedTheme={visualPreferences.theme} lang={lang} motionEnabled={visualPreferences.motionEnabled} onPreview={setPreviewTone} onCommit={commitToneTheme} onMotionChange={setMotionEnabled}/><div className="shortcuts">{t.shortcuts}</div><button className="profile-button" onClick={() => setAccountOpen(true)}><span>{user.username.slice(0, 1).toUpperCase()}</span><b>{user.username}</b></button></div>
    </header>

    <main className="workspace">
      <section className="search-panel panel" data-scene-region="search" data-mobile-section="search" data-mobile-active={mobileSection === 'search'}>
        <div className="panel-heading"><h2><Icon name="search" size={16}/>{t.searchTitle}</h2><small>{t.supports}</small></div>
        <form className="search-box" onSubmit={event => { event.preventDefault(); void doSearch(); }}><Icon name="search" size={16}/><input aria-label={t.placeholder} value={query} onChange={event => setQuery(event.target.value)} placeholder={t.placeholder}/><button className="btn gold" disabled={searching}>{searching ? '…' : t.search}</button></form>
        <div className="source-grid">{SOURCES.map(source => <label key={source} className={sources.includes(source) ? 'checked' : ''} style={{ '--source-color': sourceColors[source] } as React.CSSProperties}><input type="checkbox" checked={sources.includes(source)} onChange={() => setSources(currentSources => currentSources.includes(source) ? currentSources.filter(v => v !== source) : [...currentSources, source])}/><i/>{sourceNames[source]}</label>)}</div>
        {results.length > 0 && Object.keys(searchErrors).length > 0 && <div className="source-warning">{Object.entries(searchErrors).map(([source, message]) => `${sourceNames[source as MusicSource]}：${message}`).join(' · ')}</div>}
        <div className="load-row"><span>{t.each}</span><select value={limit} onChange={event => setLimit(Number(event.target.value))}><option>5</option><option>10</option><option>20</option><option>30</option></select><span>首结果</span><button className="btn ghost" onClick={() => void doSearch(true)}>{t.more}</button></div>
        <div className="search-mini-list">{!results.length ? <div className="empty-state"><Icon name="sparkles" size={30}/><p>{query && !searching ? t.noResults : t.idle}</p>{Object.values(searchErrors).length > 0 && <small>{Object.entries(searchErrors).map(([k, v]) => `${sourceNames[k as MusicSource]}: ${v}`).join(' · ')}</small>}</div> : results.map(item => <TrackRow key={item.id} item={item} active={current?.id === item.id} pending={pendingTrack?.id === item.id} favorite={favoriteIds.has(item.id)} onPlay={() => void playFromQueue(item, results)} onWarm={() => void warmTrack(item)} onFavorite={() => void toggleFavorite(item)} onAdd={() => setAddTrack(item)}/>)}</div>
      </section>

      <section className={`player-panel panel stage-mode-${stageMode}`} data-scene-region="player" data-mobile-section={stageMode === 'daily' ? 'daily' : 'player'} data-mobile-active={(mobileSection === 'daily' && stageMode === 'daily') || (mobileSection === 'player' && stageMode === 'player')}>
        <PlayerAtmosphere coverUrl={sceneTrack?.coverUrl} palette={visualPalette} stage={stageMode}/>
        <div className="stage-surface">
          {stageMode === 'daily' ? <>
            <div className="panel-heading player-heading"><h2><Icon name="sparkles" size={16}/>{t.dailyStage}</h2><small>{displayedDaily?.date || dailyDate}</small></div>
            <DailyStage activeTrackId={current?.id} date={displayedDaily?.date || dailyDate} favoriteIds={favoriteIds} lang={lang} loading={dailyLoading} message={daily?.message} pendingTrackId={pendingTrack?.id} playing={playing} tracks={dailyTracks} username={user.username}
              onPlayAll={() => { const first = dailyTracks[0]; if (first) { setStageMode(stageAfterRecommendationPlay(stageMode)); void playFromQueue(first, dailyTracks, { type: 'daily', id: displayedDaily?.id }); } }}
              onReturnPlayer={() => { setStageMode('player'); setMobileSection('player'); }}
              onRegenerate={() => { setDailyDate(localDateKey()); setDailyRefresh(value => value + 1); }}
              onPlay={item => { setStageMode(stageAfterRecommendationPlay(stageMode)); void playFromQueue(item, dailyTracks, { type: 'daily', id: displayedDaily?.id }); }}
              onWarm={item => void warmTrack(item)} onFavorite={item => void toggleFavorite(item)} onAdd={item => setAddTrack(item)} onDislike={item => void dislikeRecommendation(item)}/>
          </> : <>
            <div className="panel-heading player-heading"><h2><Icon name="headphones" size={16}/>{t.now}</h2><small>{resolving && pendingTrack ? `${t.loadingTrack}：${pendingTrack.title}` : resolved?.fallback ? t.playingFallback : lyrics.length && !hasTimedLyrics ? findingTimedLyricsFor === current?.id ? t.findingTimedLyrics : t.estimatedLyricHint : t.lyricFx}</small></div>
            <div className="now-card" data-track-id={current?.id || ''} data-pending-track-id={pendingTrack?.id || ''}>
              <div className={`record-wrap ${playing ? 'spinning' : ''}`}><div className="record">{displayTrack?.coverUrl ? <img src={displayTrack.coverUrl} alt=""/> : <div className="record-center"/>}</div></div>
              <div className="track-hero"><span className="now-kicker">NOW PLAYING</span><h3>{displayTrack?.title || t.noTrack}</h3><p>{displayTrack ? `${displayTrack.artist}${resolved?.fallback ? ` · ${sourceNames[resolved.actualSource]}${resolved.backupProvider ? ' · go-music-api' : ''}` : ''}` : t.pick}</p>
                <div className="progress-row"><time>{formatTime(currentTime)}</time><input aria-label="播放进度" type="range" min="0" max={duration || 0} step="0.1" value={Math.min(currentTime, duration || 0)} onChange={event => { if (audio.current) audio.current.currentTime = Number(event.target.value); }}/><time>{formatTime(duration)}</time></div>
                <div className="transport"><button aria-label="上一首" onClick={() => void playRelative(-1)}><Icon name="previous" size={14}/></button><button className="play-main" aria-label={playing ? '暂停' : '播放'} onClick={togglePlay}>{resolving ? <span className="button-loader"/> : <Icon name={playing ? 'pause' : 'play'} size={19}/>}</button><button aria-label="下一首" onClick={() => void playRelative(1)}><Icon name="next" size={14}/></button><span className="volume"><Icon name="volume" size={15}/><input aria-label="音量" type="range" min="0" max="1" step="0.01" value={user.volume} onChange={event => { const volume = Number(event.target.value); if (audio.current) audio.current.volume = volume; void setPreference({ volume }); }}/></span></div>
              </div>
              <div className="hero-actions"><button aria-label="收藏" className={current && favoriteIds.has(current.id) ? 'active' : ''} onClick={() => current && void toggleFavorite(current)}><Icon name="heart" size={16}/></button><button aria-label="下载" onClick={() => current && window.open(`/api/tracks/${encodeURIComponent(current.id)}/download`, '_blank')}><Icon name="download" size={16}/></button><span>{resolving && pendingTrack ? `${t.loadingTrack} ${pendingTrack.title}` : playing ? '播放中' : '空闲'}</span></div>
            </div>
            <div className="lyrics"><div className="lyrics-effects" aria-hidden="true"/>{lyricSeekTarget !== null && <div className="lyric-seek-status" role="status">{t.seeking} {formatTime(lyricSeekTarget)}…</div>}{!lyricFollowing && activeLyric >= 0 && <button className="lyric-follow-button" onClick={() => { setLyricFollowing(true); centerActiveLyric(); }}>{t.returnToLyric}</button>}<div className={`lyrics-scroll ${lyrics.length ? '' : 'is-empty'}`} ref={lyricBox} onPointerDown={event => { if (event.pointerType === 'mouse' && event.target === event.currentTarget && lyrics.length) setLyricFollowing(false); }} onTouchMove={() => lyrics.length && setLyricFollowing(false)} onWheel={() => lyrics.length && setLyricFollowing(false)}>{lyrics.length ? lyrics.map((line, index) => { const exact = Number.isFinite(line.time); const targetTime = exact ? line.time : estimateUntimedLyricTime(index, lyrics.length, duration, untimedLyricStart); const seekable = Number.isFinite(targetTime); return <button type="button" key={`${line.time}-${index}`} data-line={index} data-seekable={seekable} data-estimated={!exact && seekable} className={`lyric-line ${index === activeLyric ? 'active' : ''}`} aria-label={seekable ? `${exact ? '' : '约 '}${formatTime(targetTime)} ${line.text}` : line.text} title={seekable ? `${exact ? t.seekTo : t.estimatedSeekTo} ${formatTime(targetTime)}` : undefined} onClick={() => seekToLyric(targetTime, index, !exact)}><time aria-hidden="true">{seekable ? `${exact ? '' : '≈'}${formatTime(targetTime)}` : ''}</time><span>{line.text}</span></button>; }) : <div className="empty-lyrics"><Icon name="music" size={32}/>{t.emptyLyrics}</div>}</div></div>
          </>}
        </div>
        <audio ref={audio} preload="auto" onPlay={event => { if (event.currentTarget.dataset.trackId === committedTrackId.current) { listeningTracker.play(event.currentTarget.currentTime); setPlaying(true); syncMediaSession(event.currentTarget, true); } }} onPause={event => { if (event.currentTarget.dataset.trackId === committedTrackId.current) { listeningTracker.pause(event.currentTarget.currentTime, (event.currentTarget.duration || 0) * 1000); setPlaying(false); syncMediaSession(event.currentTarget, false); } }} onLoadedMetadata={event => { if (event.currentTarget.dataset.trackId === committedTrackId.current) applyPendingLyricSeek(event.currentTarget); }} onCanPlay={event => { if (event.currentTarget.dataset.trackId === committedTrackId.current) applyPendingLyricSeek(event.currentTarget); }} onSeeked={event => { if (event.currentTarget.dataset.trackId === committedTrackId.current) finishLyricSeek(event.currentTarget); }} onTimeUpdate={event => { const element = event.currentTarget; if (element.dataset.trackId !== committedTrackId.current) return; if (pendingLyricSeek.current !== null && !finishLyricSeek(element)) return; listeningTracker.tick(element.currentTime, (element.duration || 0) * 1000, !element.paused && !element.ended); setCurrentTime(element.currentTime); syncMediaSession(element, !element.paused && !element.ended); }} onDurationChange={event => { if (event.currentTarget.dataset.trackId !== committedTrackId.current) return; listeningTracker.tick(event.currentTarget.currentTime, (event.currentTarget.duration || 0) * 1000, false); setDuration(event.currentTarget.duration || 0); applyPendingLyricSeek(event.currentTarget); syncMediaSession(event.currentTarget, !event.currentTarget.paused && !event.currentTarget.ended); }} onError={event => { if (event.currentTarget.dataset.trackId === committedTrackId.current) void recoverPlayback(event.currentTarget); }} onEnded={event => { if (event.currentTarget.dataset.trackId !== committedTrackId.current) return; listeningTracker.tick(event.currentTarget.currentTime, (event.currentTarget.duration || 0) * 1000, true); listeningTracker.finish('ended'); void playRelative(1); }}/>
      </section>

      <section className="playlist-panel panel" data-scene-region="library" data-mobile-section="library" data-mobile-active={mobileSection === 'library'}>
        <div className="panel-heading"><h2><Icon name="library" size={16}/>{t.playlist}</h2></div>
        <div className="tabs">{(['daily', 'results', 'favorites', 'playlists'] as Tab[]).map(value => <button key={value} data-tab={value} className={tab === value ? 'active' : ''} onClick={() => { if (value === 'daily') { if (tab !== 'daily') setDailyDate(localDateKey()); setStageMode('daily'); } else setStageMode('player'); setTab(value); }}>{value === 'daily' ? t.daily : value === 'results' ? t.results : value === 'favorites' ? t.favorites : t.custom}</button>)}</div>
        <div className="playlist-toolbar">
          <strong>{tab === 'daily' ? `${t.daily} · ${displayedDaily?.date || dailyDate}` : tab === 'results' ? t.results : tab === 'favorites' ? t.favorites : selectedPlaylist?.name || t.custom}</strong>
          {tab === 'daily' && <div className="daily-tools"><select aria-label={t.dailyHistory} value={dailyDate} onChange={event => setDailyDate(event.target.value)}><option value={localDateKey()}>{localDateKey()}</option>{dailyHistory.filter(item => item.date !== localDateKey()).map(item => <option key={item.date} value={item.date}>{item.date}</option>)}</select><button title={t.retryDaily} disabled={dailyLoading} onClick={() => { setDailyDate(localDateKey()); setDailyRefresh(value => value + 1); }}><Icon name="sync" size={13}/></button></div>}
          {tab === 'playlists' && <div><button title={t.newList} onClick={() => setCreateOpen(true)}><Icon name="add" size={13}/></button><button title={t.import} onClick={() => { setImportOpen(true); setImportJob(null); }}><Icon name="import" size={13}/></button><button title={t.backup} onClick={() => void exportBackup()}><Icon name="backup" size={13}/></button><label className="icon-upload" title={t.restoreData}><Icon name="restore" size={13}/><input type="file" accept="application/json" onChange={event => event.target.files?.[0] && void restoreBackup(event.target.files[0])}/></label>{selectedPlaylist?.source && <button title={t.sync} onClick={() => void syncPlaylist()}><Icon name="sync" size={13}/></button>}</div>}
        </div>
        <div className="playlist-content">
          {tab === 'daily' && <>{dailyLoading && daily?.status !== 'completed' && <div className="daily-status"><Icon name="sparkles" size={20}/><strong>{t.generatingDaily}</strong><small>{dailyFallback ? `正在生成，先显示 ${dailyFallback.date} 的推荐` : daily?.message || '首次生成需要连接音乐源，请稍候'}</small></div>}{dailyTracks.length ? dailyTracks.map(item => <TrackRow key={item.id} item={item} active={current?.id === item.id} pending={pendingTrack?.id === item.id} favorite={favoriteIds.has(item.id)} reason={item.reason} onPlay={() => void playFromQueue(item, dailyTracks, { type: 'daily', id: displayedDaily?.id })} onWarm={() => void warmTrack(item)} onFavorite={() => void toggleFavorite(item)} onAdd={() => setAddTrack(item)} onDislike={() => void dislikeRecommendation(item)}/>) : !dailyLoading && <div className="empty-state"><Icon name="sparkles" size={28}/><p>{daily?.message || t.generatingDaily}</p><button className="btn ghost" onClick={() => setDailyRefresh(value => value + 1)}>{t.retryDaily}</button></div>}</>}
          {tab === 'results' && (results.length ? results.map(item => <TrackRow key={item.id} item={item} active={current?.id === item.id} pending={pendingTrack?.id === item.id} favorite={favoriteIds.has(item.id)} onPlay={() => void playFromQueue(item, results)} onWarm={() => void warmTrack(item)} onFavorite={() => void toggleFavorite(item)} onAdd={() => setAddTrack(item)}/>) : <div className="empty-state"><Icon name="search" size={28}/><p>{t.empty}</p></div>)}
          {tab === 'favorites' && (favorites.length ? favorites.map(item => <TrackRow key={item.id} item={item} active={current?.id === item.id} pending={pendingTrack?.id === item.id} favorite onPlay={() => void playFromQueue(item, favorites)} onWarm={() => void warmTrack(item)} onFavorite={() => void toggleFavorite(item)} onAdd={() => setAddTrack(item)}/>) : <div className="empty-state"><Icon name="heart" size={28}/><p>{t.empty}</p></div>)}
          {tab === 'playlists' && <>{playlists.length ? <div className="playlist-cards">{playlists.map(item => <button key={item.id} className={selectedPlaylist?.id === item.id ? 'active' : ''} onClick={() => void openPlaylist(item)}>{item.coverUrl ? <img src={item.coverUrl} alt=""/> : <span><Icon name="music" size={18}/></span>}<b>{item.name}</b><small>{item.trackCount} 首 {item.source ? `· ${sourceNames[item.source]}` : ''}</small></button>)}</div> : <div className="empty-state"><Icon name="add" size={28}/><p>{t.empty}</p></div>}
            {selectedPlaylist && <><input className="playlist-search" value={playlistFilter} onChange={event => setPlaylistFilter(event.target.value)} placeholder={t.searchInList}/><div className="selected-tracks">{visiblePlaylistTracks.map(item => <TrackRow key={item.id} item={item} active={current?.id === item.id} pending={pendingTrack?.id === item.id} favorite={favoriteIds.has(item.id)} draggable onDragStart={() => { draggedTrack.current = item.id; }} onDrop={() => void reorder(item.id)} onPlay={() => void playFromQueue(item, selectedPlaylist.tracks.filter(track => !track.excluded))} onWarm={() => void warmTrack(item)} onFavorite={() => void toggleFavorite(item)} onRemove={() => void removeFromPlaylist(item.id)}/>)}</div></>}
          </>}
        </div>
        <div className="play-modes"><button className={user.playMode === 'list' ? 'active' : ''} title={t.listMode} onClick={() => void setPreference({ playMode: 'list' })}><Icon name="repeat" size={13}/></button><button className={user.playMode === 'loop' ? 'active' : ''} title={t.loopMode} onClick={() => void setPreference({ playMode: 'loop' })}><Icon name="repeatOne" size={13}/></button><button className={user.playMode === 'shuffle' ? 'active' : ''} title={t.shuffleMode} onClick={() => void setPreference({ playMode: 'shuffle' })}><Icon name="shuffle" size={13}/></button><span>{modeLabel}</span></div>
      </section>
    </main>
    {showMobileMini && current && <MiniPlayer
      track={displayTrack || current}
      playing={playing}
      resolving={resolving}
      onToggle={togglePlay}
      onOpen={() => switchMobileSection('player')}
    />}
    <MobileNavigation active={mobileSection} lang={lang} playing={playing} onChange={switchMobileSection}/>
    <footer>{t.footer}</footer>

    {createOpen && <Modal title={t.newList} onClose={() => setCreateOpen(false)}><label className="modal-label">{t.name}<input autoFocus value={newName} onChange={event => setNewName(event.target.value)} onKeyDown={event => event.key === 'Enter' && void createPlaylist()}/></label><div className="modal-actions"><button className="btn ghost" onClick={() => setCreateOpen(false)}>{t.cancel}</button><button className="btn primary" onClick={() => void createPlaylist()}>{t.create}</button></div></Modal>}
    {importOpen && <Modal title={t.import} onClose={() => setImportOpen(false)} wide><div className="source-pickers">{SOURCES.map(source => <button key={source} className={importSource === source ? 'active' : ''} style={{ '--source-color': sourceColors[source] } as React.CSSProperties} onClick={() => setImportSource(source)}><i/>{sourceNames[source]}</button>)}</div><label className="modal-label">{t.publicLink}<input value={importInput} onChange={event => setImportInput(event.target.value)} placeholder="https://… 或数字 ID"/></label>{importJob && <div className={`import-progress ${importJob.status}`}><div><span style={{ width: `${importJob.progress}%` }}/></div><strong>{importJob.message}</strong><small>{importJob.processed}/{importJob.total || '?'} · {importJob.status}</small>{importJob.failures.length > 0 && <details><summary>失败详情</summary>{importJob.failures.map((item, i) => <p key={i}>{item.track ? `${item.track}: ` : ''}{item.reason}</p>)}</details>}</div>}<div className="modal-actions"><button className="btn ghost" onClick={() => setImportOpen(false)}>{t.close}</button><button className="btn primary" disabled={!importInput.trim() || importJob?.status === 'running'} onClick={() => void startImport()}>{importJob?.status === 'running' ? t.importing : t.startImport}</button></div></Modal>}
    {addTrack && <Modal title={t.add} onClose={() => setAddTrack(null)}><div className="add-list">{playlists.length ? playlists.map(item => <button key={item.id} onClick={() => void addToPlaylist(item.id)}><span>♫</span><b>{item.name}</b><small>{item.trackCount} 首</small></button>) : <p>{t.empty}</p>}</div><div className="modal-actions"><button className="btn ghost" onClick={() => setAddTrack(null)}>{t.cancel}</button><button className="btn primary" onClick={() => { setAddTrack(null); setCreateOpen(true); }}>{t.newList}</button></div></Modal>}
    {accountOpen && <Modal title={t.settings} onClose={() => setAccountOpen(false)}><div className="account-card"><div className="avatar-large">{user.username.slice(0, 1).toUpperCase()}</div><h3>{user.username}</h3><p>{t.accountHint}</p>{installPrompt && <button className="btn primary wide install-app" onClick={() => void installApp()}>{t.installApp}</button>}<button className="btn ghost wide" onClick={async () => { const currentPassword = window.prompt('请输入当前密码'); if (!currentPassword) return; const newPassword = window.prompt('请输入新密码（8–72 位）'); if (!newPassword) return; try { await api('/api/auth/password', json('PATCH', { currentPassword, newPassword })); setUser(null); } catch (error) { showToast(error instanceof Error ? error.message : t.failed); } }}>{t.changePassword}</button><button className="btn ghost wide account-logout" onClick={async () => { await api('/api/auth/logout', json('POST')); setUser(null); }}>{t.logout}</button><button className="danger-link" onClick={async () => { const password = window.prompt('请输入当前密码以删除本地账户'); if (!password) return; try { await api('/api/auth/account', json('DELETE', { password })); setUser(null); } catch (error) { showToast(error instanceof Error ? error.message : t.failed); } }}>{t.deleteAccount}</button></div></Modal>}
    {toast && <div className="toast" role="status">⚡ {toast}</div>}
    <ToneTransitionLayer transition={toneTransition}/>
  </div>;
}
