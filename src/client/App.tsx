import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, json } from './api';
import { PlaybackCache } from './playerCache';
import { SOURCES, type ImportJob, type MusicSource, type PlaylistDetail, type PlaylistSummary, type ResolvedTrack, type Track, type User } from '../shared/types';

type Lang = 'zh' | 'en';
type Tab = 'results' | 'favorites' | 'playlists';

const sourceNames: Record<MusicSource, string> = { migu: '咪咕', netease: '网易云', qq: 'QQ', kuwo: '酷我' };
const sourceColors: Record<MusicSource, string> = { migu: '#ff9d2e', netease: '#ff4d65', qq: '#38d9f3', kuwo: '#d757ff' };
const copy = {
  zh: {
    shortcuts: '快捷键：Space 播放/暂停 · ←/→ 跳转 · ↑/↓ 音量 · N/P 切歌 · F 收藏',
    searchTitle: '歌曲搜索', supports: '支持咪咕 / 网易云 / QQ / 酷我', placeholder: '输入歌名 / 歌手，回车搜索…', search: '搜索', each: '每个源加载', more: '加载更多',
    idle: '尚未搜索，试试输入“林俊杰”？', now: '正在播放', lyricFx: '点击歌词定位 · 炫酷霓虹', pick: '搜索并播放一首歌吧！', noTrack: '暂未选择歌曲',
    playlist: '播放列表', results: '搜索结果', favorites: '我的收藏', custom: '自建歌单', newList: '新建歌单', import: '导入歌单', backup: '备份', sync: '同步',
    emptyLyrics: '暂无歌词，试着播放一首支持歌词的歌曲。', empty: '这里还没有歌曲。', login: '登录', register: '注册', username: '用户名', password: '密码',
    createAccount: '创建本地账户', welcome: '欢迎回来', accountHint: '所有收藏与歌单只保存在这台电脑。', logout: '退出', settings: '账户设置', changePassword: '修改密码', deleteAccount: '删除账户',
    source: '音乐源', publicLink: '公开歌单链接或 ID', startImport: '开始导入', importing: '正在导入', close: '关闭', create: '创建', cancel: '取消', name: '歌单名称',
    add: '加入歌单', searchInList: '搜索歌单内歌曲…', exportData: '导出数据', restoreData: '恢复数据', footer: '本站仅作为学习演示，音乐版权归各平台与原作者所有。',
    noResults: '没有找到歌曲，音乐源可能暂时不可用。', failed: '操作失败', playingFallback: '正在使用替代音源', loadingTrack: '正在缓冲', listMode: '列表循环', loopMode: '单曲循环', shuffleMode: '随机播放', seekTo: '定位到', seeking: '正在定位', seekUnsupported: '当前音源暂不支持时间定位'
  },
  en: {
    shortcuts: 'Shortcuts: Space play/pause · ←/→ seek · ↑/↓ volume · N/P track · F favorite',
    searchTitle: 'Song Search', supports: 'Migu / NetEase / QQ / Kuwo', placeholder: 'Song or artist, press Enter…', search: 'Search', each: 'Per source', more: 'Load more',
    idle: 'Search for something you love.', now: 'Now Playing', lyricFx: 'Click lyrics to seek · Neon glow', pick: 'Search and play a song!', noTrack: 'No track selected',
    playlist: 'Playlists', results: 'Results', favorites: 'Favorites', custom: 'My Playlists', newList: 'Create', import: 'Import', backup: 'Backup', sync: 'Sync',
    emptyLyrics: 'No lyrics available for this track.', empty: 'Nothing here yet.', login: 'Sign in', register: 'Register', username: 'Username', password: 'Password',
    createAccount: 'Create local account', welcome: 'Welcome back', accountHint: 'Favorites and playlists stay on this computer.', logout: 'Sign out', settings: 'Account', changePassword: 'Change password', deleteAccount: 'Delete account',
    source: 'Source', publicLink: 'Public playlist URL or ID', startImport: 'Import', importing: 'Importing', close: 'Close', create: 'Create', cancel: 'Cancel', name: 'Playlist name',
    add: 'Add to playlist', searchInList: 'Search in playlist…', exportData: 'Export', restoreData: 'Restore', footer: 'For learning only. Music rights belong to their platforms and creators.',
    noResults: 'No tracks found. A source may be temporarily unavailable.', failed: 'Action failed', playingFallback: 'Using fallback source', loadingTrack: 'Buffering', listMode: 'List loop', loopMode: 'Repeat one', shuffleMode: 'Shuffle', seekTo: 'Seek to', seeking: 'Seeking', seekUnsupported: 'This source does not currently support seeking'
  }
} as const;

function formatTime(value: number) {
  if (!Number.isFinite(value)) return '00:00'; const minutes = Math.floor(value / 60); const seconds = Math.floor(value % 60); return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function parseLrc(raw: string | null) {
  if (!raw) return [] as Array<{ time: number; text: string }>;
  const lines: Array<{ time: number; text: string }> = [];
  raw.split(/\r?\n/).forEach(line => {
    const words = line.replace(/\[[a-z]+:.*?\]/gi, '').replace(/\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/g, '').trim();
    if (!words) return;
    for (const match of line.matchAll(/\[(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\]/g)) lines.push({ time: Number(match[1]) * 60 + Number(match[2]), text: words });
  });
  const timed = lines.filter(line => line.text).sort((a, b) => a.time - b.time);
  if (timed.length) return timed;
  return raw.split(/\r?\n/).filter(line => !/^\[(ar|ti|al|by|offset):/i.test(line.trim())).map(line => line.replace(/^\[[^\]]+\]\s*/, '').trim()).filter(Boolean).map(text => ({ time: Number.POSITIVE_INFINITY, text }));
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
  const [mode, setMode] = useState<'login' | 'register'>('login'); const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); setError(''); setBusy(true); try { const result = await api<{ user: User }>(`/api/auth/${mode}`, json('POST', { username, password })); onAuth(result.user); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); } };
  return <main className="auth-shell">
    <div className="aurora aurora-one"/><div className="aurora aurora-two"/>
    <section className="auth-card panel">
      <div className="brand-mark"><img src="/pikachu.gif" alt="Pikachu"/></div>
      <div className="eyebrow">PIKACHU MUSIC</div><h1>{mode === 'login' ? copy.zh.welcome : copy.zh.createAccount}</h1><p>{copy.zh.accountHint}</p>
      <form onSubmit={submit}>
        <label>{copy.zh.username}<input autoFocus value={username} onChange={e => setUsername(e.target.value)} minLength={2} maxLength={24} autoComplete="username"/></label>
        <label>{copy.zh.password}<input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={8} maxLength={72} autoComplete={mode === 'login' ? 'current-password' : 'new-password'}/></label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="btn primary wide" disabled={busy}>{busy ? '…' : mode === 'login' ? copy.zh.login : copy.zh.register}</button>
      </form>
      <button className="text-button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>{mode === 'login' ? '没有账户？创建一个' : '已有账户？返回登录'}</button>
    </section>
  </main>;
}

function TrackRow({ item, active, pending, draggable, onPlay, onWarm, onFavorite, favorite, onAdd, onRemove, onDragStart, onDrop }: {
  item: Track; active?: boolean; pending?: boolean; draggable?: boolean; favorite?: boolean; onPlay: () => void; onWarm?: () => void; onFavorite: () => void; onAdd?: () => void; onRemove?: () => void; onDragStart?: () => void; onDrop?: () => void;
}) {
  return <div className={`track-row ${active ? 'active' : ''} ${pending ? 'pending' : ''}`} draggable={draggable} onDragStart={onDragStart} onDragOver={event => draggable && event.preventDefault()} onDrop={onDrop}>
    <button className="track-main" onClick={onPlay} onPointerEnter={onWarm} onFocus={onWarm} title="播放">
      <span className="track-source" style={{ '--source-color': sourceColors[item.source] } as React.CSSProperties}>{sourceNames[item.source].slice(0, 1)}</span>
      <span className="track-copy"><strong>{item.title}</strong><small>{item.artist}{item.album ? ` · ${item.album}` : ''}</small></span>
      {item.duration > 0 && <time>{formatTime(item.duration / 1000)}</time>}
    </button>
    <div className="row-actions"><button onClick={onFavorite} aria-label="收藏">{favorite ? '♥' : '♡'}</button>{onAdd && <button onClick={onAdd} aria-label="加入歌单">＋</button>}{onRemove && <button onClick={onRemove} aria-label="移除">×</button>}</div>
  </div>;
}

function Modal({ title, children, onClose, wide = false }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return <div className="modal-backdrop" onMouseDown={event => event.target === event.currentTarget && onClose()}><section className={`modal-card ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button onClick={onClose} aria-label="关闭">×</button></header>{children}</section></div>;
}

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined); const lang: Lang = user?.language || 'zh'; const t = copy[lang];
  const [query, setQuery] = useState(''); const [sources, setSources] = useState<MusicSource[]>([...SOURCES]); const [limit, setLimit] = useState(10); const [results, setResults] = useState<Track[]>([]); const [searching, setSearching] = useState(false); const [searchErrors, setSearchErrors] = useState<Record<string, string>>({});
  const [favorites, setFavorites] = useState<Track[]>([]); const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]); const [selectedPlaylist, setSelectedPlaylist] = useState<PlaylistDetail | null>(null); const [tab, setTab] = useState<Tab>('results'); const [playlistFilter, setPlaylistFilter] = useState('');
  const [current, setCurrent] = useState<Track | null>(null); const [pendingTrack, setPendingTrack] = useState<Track | null>(null); const [resolved, setResolved] = useState<ResolvedTrack | null>(null); const [playing, setPlaying] = useState(false); const [resolving, setResolving] = useState(false); const [currentTime, setCurrentTime] = useState(0); const [duration, setDuration] = useState(0); const [toast, setToast] = useState(''); const [lyricSeekTarget, setLyricSeekTarget] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false); const [newName, setNewName] = useState(''); const [importOpen, setImportOpen] = useState(false); const [importSource, setImportSource] = useState<MusicSource>('netease'); const [importInput, setImportInput] = useState(''); const [importJob, setImportJob] = useState<ImportJob | null>(null); const [accountOpen, setAccountOpen] = useState(false); const [addTrack, setAddTrack] = useState<Track | null>(null);
  const audio = useRef<HTMLAudioElement>(null); const lyricBox = useRef<HTMLDivElement>(null); const draggedTrack = useRef<string | null>(null); const activeRequest = useRef(0); const requestedTrack = useRef<Track | null>(null); const committedTrackId = useRef<string | null>(null); const playbackCache = useMemo(() => new PlaybackCache(window.localStorage), []); const resolveRequests = useRef(new Map<string, Promise<ResolvedTrack>>()); const warmedAudio = useRef(new Map<string, { element: HTMLAudioElement; url: string; usedAt: number }>()); const pendingLyricSeek = useRef<number | null>(null); const lyricSeekTimer = useRef<number | null>(null); const lyricSeekSequence = useRef(0);
  const lyrics = useMemo(() => parseLrc(resolved?.lyric || null), [resolved?.lyric]);
  const activeLyric = useMemo(() => Math.max(0, lyrics.findLastIndex(line => line.time <= currentTime)), [lyrics, currentTime]);
  const favoriteIds = useMemo(() => new Set(favorites.map(item => item.id)), [favorites]);

  const showToast = useCallback((message: string) => { setToast(message); window.setTimeout(() => setToast(''), 2600); }, []);
  const refreshLibrary = useCallback(async () => {
    const [fav, lists] = await Promise.all([api<{ tracks: Track[] }>('/api/favorites'), api<{ playlists: PlaylistSummary[] }>('/api/playlists')]); setFavorites(fav.tracks); setPlaylists(lists.playlists);
  }, []);
  useEffect(() => { api<{ user: User | null }>('/api/auth/me').then(result => setUser(result.user)).catch(() => setUser(null)); }, []);
  useEffect(() => { document.title = user ? `${user.username}的音乐小屋` : '音乐小屋'; }, [user]);
  useEffect(() => {
    const timers = new Set<number>();
    const createRipple = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      const target = event.target.closest<HTMLElement>('button, .track-row, .source-grid label, .icon-upload, .search-box, .load-row, .search-mini-list, .now-card, .lyrics, .tabs, .playlist-toolbar, .playlist-content, .play-modes, .import-progress, .add-list, .account-card, .modal-card, .panel');
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
  useEffect(() => { if (!selectedPlaylist) return; api<{ playlist: PlaylistDetail }>(`/api/playlists/${encodeURIComponent(selectedPlaylist.id)}`).then(v => setSelectedPlaylist(v.playlist)).catch(() => setSelectedPlaylist(null)); }, [playlists]);
  useEffect(() => { if (lyricBox.current) lyricBox.current.querySelector(`[data-line="${activeLyric}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, [activeLyric]);
  useEffect(() => () => {
    if (lyricSeekTimer.current !== null) window.clearTimeout(lyricSeekTimer.current);
    warmedAudio.current.forEach(entry => disposeAudio(entry.element)); warmedAudio.current.clear();
  }, []);

  const doSearch = async (append = false) => {
    if (!query.trim() || !sources.length) return; setSearching(true); if (!append) { setResults([]); setSearchErrors({}); }
    try { const size = append ? Math.min(30, limit + 10) : limit; const data = await api<{ tracks: Track[]; errors: Record<string, string> }>(`/api/search?q=${encodeURIComponent(query)}&sources=${sources.join(',')}&limit=${size}`); setResults(data.tracks.map(normalizeTrack)); setSearchErrors(data.errors); if (append) setLimit(size); setTab('results'); }
    catch (error) { showToast(error instanceof Error ? error.message : t.failed); } finally { setSearching(false); }
  };

  const queue = useMemo(() => tab === 'favorites' ? favorites : tab === 'playlists' && selectedPlaylist ? selectedPlaylist.tracks.filter(item => !item.excluded) : results, [tab, favorites, selectedPlaylist, results]);
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
    const requestId = ++activeRequest.current; lyricSeekSequence.current += 1; pendingLyricSeek.current = null; setLyricSeekTarget(null); if (lyricSeekTimer.current !== null) window.clearTimeout(lyricSeekTimer.current); lyricSeekTimer.current = null;
    const inFlightAudio = audio.current; if (inFlightAudio && inFlightAudio.dataset.requestId && inFlightAudio.dataset.trackId !== committedTrackId.current) inFlightAudio.pause();
    const normalized = normalizeTrack(item); requestedTrack.current = normalized; setPendingTrack(normalized); setResolving(true);
    try {
      let next = await resolveTrack(normalized); if (requestId !== activeRequest.current) return;
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
        element.volume = user?.volume ?? 0.8; element.dataset.trackId = normalized.id; committedTrackId.current = normalized.id;
        setCurrent(normalized); setResolved(candidate); setCurrentTime(0); setDuration(Number.isFinite(element.duration) ? element.duration : 0); setPendingTrack(null); requestedTrack.current = null; setResolving(false); setPlaying(false);
        const playAttempt = element.play().then(() => ({ ok: true as const })).catch(error => ({ ok: false as const, error }));
        void playAttempt.then(result => { if (requestId !== activeRequest.current) return; if (result.ok) { setPlaying(true); return; } if ((result.error as DOMException)?.name !== 'AbortError') showToast('歌曲已加载，点击播放按钮即可继续。'); });
        return true;
      };

      try { if (await activate(next)) return; }
      catch {
        playbackCache.forgetResolved(normalized.id); const expired = warmedAudio.current.get(normalized.id); if (expired) { warmedAudio.current.delete(normalized.id); disposeAudio(expired.element); }
        next = await resolveTrack(normalized, true); if (requestId !== activeRequest.current) return;
        try { if (await activate(next)) return; }
        catch (error) { if (requestId === activeRequest.current && element.dataset.requestId === String(requestId)) await restorePrevious(); throw error; }
      }
      if (requestId === activeRequest.current && element.dataset.requestId === String(requestId)) await restorePrevious();
    }
    catch (error) { if (requestId === activeRequest.current) showToast(error instanceof Error ? error.message : t.failed); }
    finally { if (requestId === activeRequest.current) { setResolving(false); setPendingTrack(null); requestedTrack.current = null; } }
  }, [resolveTrack, showToast, t.failed, user?.volume]);
  const playRelative = useCallback((direction: 1 | -1) => { if (!queue.length) return; const base = requestedTrack.current || current; const index = base ? queue.findIndex(item => item.id === base.id) : -1; let next = index + direction; if (user?.playMode === 'shuffle') next = Math.floor(Math.random() * queue.length); if (next < 0) next = queue.length - 1; if (next >= queue.length) next = 0; void playTrack(queue[next]); }, [queue, current, user?.playMode, playTrack]);
  const togglePlay = useCallback(() => { const element = audio.current; if (!element) return; if (!current && queue[0]) return void playTrack(queue[0]); if (element.paused) void element.play(); else element.pause(); }, [current, queue, playTrack]);
  useEffect(() => {
    if (!queue.length) return;
    const base = requestedTrack.current || current; const index = base ? queue.findIndex(item => item.id === base.id) : -1;
    const candidates = index >= 0 ? [queue[(index + 1) % queue.length], queue[(index - 1 + queue.length) % queue.length]] : queue.slice(0, 2);
    candidates.filter((item): item is Track => Boolean(item && item.id !== base?.id)).forEach(item => { void warmTrack(item); });
  }, [queue, current, warmTrack]);
  const applyPendingLyricSeek = useCallback((element: HTMLAudioElement) => {
    const requested = pendingLyricSeek.current; if (requested === null || element.readyState < 1) return;
    const target = Number.isFinite(element.duration) && element.duration > 0 ? Math.min(requested, Math.max(0, element.duration - .05)) : requested;
    if (target !== requested) { pendingLyricSeek.current = target; setLyricSeekTarget(target); }
    try { const fastSeek = (element as HTMLAudioElement & { fastSeek?: (value: number) => void }).fastSeek; if (typeof fastSeek === 'function') fastSeek.call(element, target); else element.currentTime = target; }
    catch { /* loadedmetadata/canplay will retry while the target remains pending */ }
  }, []);
  const finishLyricSeek = useCallback((element: HTMLAudioElement) => {
    const target = pendingLyricSeek.current; if (target === null || Math.abs(element.currentTime - target) > 1.5) return false;
    pendingLyricSeek.current = null; setLyricSeekTarget(null); if (lyricSeekTimer.current !== null) window.clearTimeout(lyricSeekTimer.current); lyricSeekTimer.current = null; setCurrentTime(element.currentTime); return true;
  }, []);
  const seekToLyric = (time: number) => {
    const element = audio.current; if (!Number.isFinite(time) || !element || !element.currentSrc) return;
    const sequence = ++lyricSeekSequence.current; pendingLyricSeek.current = time; setLyricSeekTarget(time); setCurrentTime(time); applyPendingLyricSeek(element);
    if (lyricSeekTimer.current !== null) window.clearTimeout(lyricSeekTimer.current);
    lyricSeekTimer.current = window.setTimeout(() => { const active = audio.current; if (sequence !== lyricSeekSequence.current || !active || pendingLyricSeek.current === null) return; applyPendingLyricSeek(active); window.setTimeout(() => { const latest = audio.current; if (sequence !== lyricSeekSequence.current || !latest || pendingLyricSeek.current === null || finishLyricSeek(latest)) return; pendingLyricSeek.current = null; setLyricSeekTarget(null); setCurrentTime(latest.currentTime); showToast(t.seekUnsupported); }, 900); }, 11_000);
  };

  const toggleFavorite = async (item: Track) => { try { if (favoriteIds.has(item.id)) await api(`/api/favorites/${encodeURIComponent(item.id)}`, json('DELETE')); else await api('/api/favorites', json('POST', item)); await refreshLibrary(); showToast(favoriteIds.has(item.id) ? '已取消收藏' : '已添加到收藏'); } catch (error) { showToast(error instanceof Error ? error.message : t.failed); } };
  const setPreference = async (patch: Partial<Pick<User, 'language' | 'volume' | 'playMode'>>) => { if (!user) return; setUser({ ...user, ...patch }); await api<{ user: User }>('/api/auth/preferences', json('PATCH', patch)).catch(() => undefined); };

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

  const watchImport = (job: ImportJob) => { setImportJob(job); const stream = new EventSource(`/api/imports/${job.id}/events`); stream.onmessage = async event => { const next = JSON.parse(event.data) as ImportJob; setImportJob(next); if (['completed', 'partial', 'failed'].includes(next.status)) { stream.close(); if (next.status !== 'failed') { await refreshLibrary(); if (next.playlistId) { const detail = await api<{ playlist: PlaylistDetail }>(`/api/playlists/${next.playlistId}`); setSelectedPlaylist(detail.playlist); setTab('playlists'); } } } }; stream.onerror = () => stream.close(); };
  const startImport = async () => { try { const source = /^\d+$/.test(importInput.trim()) ? importSource : undefined; const result = await api<{ job: ImportJob }>('/api/imports', json('POST', { input: importInput, source })); watchImport(result.job); } catch (error) { showToast(error instanceof Error ? error.message : t.failed); } };
  const syncPlaylist = async () => { if (!selectedPlaylist) return; try { const result = await api<{ job: ImportJob }>(`/api/playlists/${selectedPlaylist.id}/sync`, json('POST')); setImportOpen(true); watchImport(result.job); } catch (error) { showToast(error instanceof Error ? error.message : t.failed); } };

  const exportBackup = async () => { const response = await fetch('/api/backup/export'); if (!response.ok) return showToast(t.failed); const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `pikachu-backup-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url); };
  const restoreBackup = async (file: File) => { try { const data = JSON.parse(await file.text()); const preview = await api<{ preview: { favorites: number; playlists: number; tracks: number } }>('/api/backup/restore', json('POST', { mode: 'preview', data })); if (!window.confirm(`将合并 ${preview.preview.favorites} 个收藏、${preview.preview.playlists} 个歌单、${preview.preview.tracks} 首歌曲。继续？`)) return; await api('/api/backup/restore', json('POST', { mode: 'merge', data })); await refreshLibrary(); showToast('数据恢复完成'); } catch (error) { showToast(error instanceof Error ? error.message : t.failed); } };

  if (user === undefined) return <div className="loading-screen"><div className="loader">⚡</div></div>;
  if (!user) return <AuthScreen onAuth={setUser}/>;

  const visiblePlaylistTracks = selectedPlaylist?.tracks.filter(item => !item.excluded && `${item.title} ${item.artist}`.toLowerCase().includes(playlistFilter.toLowerCase())) || [];
  const displayTrack = current && resolved ? { ...current, title: resolved.title || current.title, artist: resolved.artist || current.artist, album: resolved.album || current.album, coverUrl: resolved.coverUrl || current.coverUrl } : current;
  const modeLabel = user.playMode === 'list' ? t.listMode : user.playMode === 'loop' ? t.loopMode : t.shuffleMode;
  return <div className="app-shell">
    <div className="particle-field" aria-hidden="true">{Array.from({ length: 26 }, (_, i) => <i key={i} style={{ '--x': `${(i * 37) % 100}%`, '--y': `${(i * 61) % 100}%`, '--d': `${5 + (i % 7)}s`, '--s': `${2 + (i % 4)}px` } as React.CSSProperties}/>)}</div>
    <header className="topbar panel">
      <div className="brand"><div className="logo-ring"><img src="/pikachu.gif" alt="Pikachu"/></div><div><h1>{lang === 'zh' ? `${user.username}的音乐小屋` : `${user.username}'s Music Cottage`}</h1></div></div>
      <div className="header-actions"><div className="language"><button className={lang === 'zh' ? 'active' : ''} onClick={() => void setPreference({ language: 'zh' })}>中</button><button className={lang === 'en' ? 'active' : ''} onClick={() => void setPreference({ language: 'en' })}>EN</button></div><div className="shortcuts">{t.shortcuts}</div><button className="profile-button" onClick={() => setAccountOpen(true)}><span>{user.username.slice(0, 1).toUpperCase()}</span>{user.username}</button></div>
    </header>

    <main className="workspace">
      <section className="search-panel panel">
        <div className="panel-heading"><h2><span>🔍</span>{t.searchTitle}</h2><small>{t.supports}</small></div>
        <form className="search-box" onSubmit={event => { event.preventDefault(); void doSearch(); }}><span>🔍</span><input aria-label={t.placeholder} value={query} onChange={event => setQuery(event.target.value)} placeholder={t.placeholder}/><button className="btn gold" disabled={searching}>{searching ? '…' : t.search}</button></form>
        <div className="source-grid">{SOURCES.map(source => <label key={source} className={sources.includes(source) ? 'checked' : ''} style={{ '--source-color': sourceColors[source] } as React.CSSProperties}><input type="checkbox" checked={sources.includes(source)} onChange={() => setSources(currentSources => currentSources.includes(source) ? currentSources.filter(v => v !== source) : [...currentSources, source])}/><i/>{sourceNames[source]}</label>)}</div>
        <div className="load-row"><span>{t.each}</span><select value={limit} onChange={event => setLimit(Number(event.target.value))}><option>5</option><option>10</option><option>20</option><option>30</option></select><span>首结果</span><button className="btn ghost" onClick={() => void doSearch(true)}>{t.more}</button></div>
        <div className="search-mini-list">{!results.length ? <div className="empty-state"><span>✦</span><p>{query && !searching ? t.noResults : t.idle}</p>{Object.values(searchErrors).length > 0 && <small>{Object.entries(searchErrors).map(([k, v]) => `${sourceNames[k as MusicSource]}: ${v}`).join(' · ')}</small>}</div> : results.slice(0, 14).map(item => <TrackRow key={item.id} item={item} active={current?.id === item.id} pending={pendingTrack?.id === item.id} favorite={favoriteIds.has(item.id)} onPlay={() => void playTrack(item)} onWarm={() => void warmTrack(item)} onFavorite={() => void toggleFavorite(item)} onAdd={() => setAddTrack(item)}/>)}</div>
      </section>

      <section className="player-panel panel">
        <div className="panel-heading player-heading"><h2><span>🎧</span>{t.now}</h2><small>{resolving && pendingTrack ? `${t.loadingTrack}：${pendingTrack.title}` : resolved?.fallback ? t.playingFallback : t.lyricFx}</small></div>
        <div className="now-card" data-track-id={current?.id || ''} data-pending-track-id={pendingTrack?.id || ''}>
          <div className={`record-wrap ${playing ? 'spinning' : ''}`}><div className="record">{displayTrack?.coverUrl ? <img src={displayTrack.coverUrl} alt=""/> : <div className="record-center"/>}</div></div>
          <div className="track-hero"><h3>{displayTrack?.title || t.noTrack}</h3><p>{displayTrack ? `${displayTrack.artist}${resolved?.fallback ? ` · ${sourceNames[resolved.actualSource]}` : ''}` : t.pick}</p>
            <div className="progress-row"><time>{formatTime(currentTime)}</time><input type="range" min="0" max={duration || 0} step="0.1" value={Math.min(currentTime, duration || 0)} onChange={event => { if (audio.current) audio.current.currentTime = Number(event.target.value); }}/><time>{formatTime(duration)}</time></div>
            <div className="transport"><button onClick={() => playRelative(-1)}>⏮</button><button className="play-main" onClick={togglePlay}>{resolving ? '…' : playing ? '❚❚' : '▶'}</button><button onClick={() => playRelative(1)}>⏭</button><span className="volume">🔊<input aria-label="音量" type="range" min="0" max="1" step="0.01" value={user.volume} onChange={event => { const volume = Number(event.target.value); if (audio.current) audio.current.volume = volume; void setPreference({ volume }); }}/></span></div>
          </div>
          <div className="hero-actions"><button className={current && favoriteIds.has(current.id) ? 'active' : ''} onClick={() => current && void toggleFavorite(current)}>♥</button><button onClick={() => current && window.open(`/api/tracks/${encodeURIComponent(current.id)}/download`, '_blank')}>⬇</button><span>{resolving && pendingTrack ? `${t.loadingTrack} ${pendingTrack.title}` : playing ? '播放中' : '空闲'}</span></div>
        </div>
        <div className="lyrics"><div className="lyrics-effects" aria-hidden="true"/>{lyricSeekTarget !== null && <div className="lyric-seek-status" role="status">{t.seeking} {formatTime(lyricSeekTarget)}…</div>}<div className={`lyrics-scroll ${lyrics.length ? '' : 'is-empty'}`} ref={lyricBox}>{lyrics.length ? lyrics.map((line, index) => { const seekable = Number.isFinite(line.time); return <button type="button" key={`${line.time}-${index}`} data-line={index} data-seekable={seekable} className={`lyric-line ${index === activeLyric ? 'active' : ''}`} aria-label={seekable ? `${formatTime(line.time)} ${line.text}` : line.text} title={seekable ? `${t.seekTo} ${formatTime(line.time)}` : undefined} onClick={() => seekToLyric(line.time)}><time aria-hidden="true">{seekable ? formatTime(line.time) : ''}</time><span>{line.text}</span></button>; }) : <div className="empty-lyrics"><span>♫</span>{t.emptyLyrics}</div>}</div></div>
        <audio ref={audio} preload="auto" onPlay={event => { if (event.currentTarget.dataset.trackId === committedTrackId.current) setPlaying(true); }} onPause={event => { if (event.currentTarget.dataset.trackId === committedTrackId.current) setPlaying(false); }} onLoadedMetadata={event => { if (event.currentTarget.dataset.trackId === committedTrackId.current) applyPendingLyricSeek(event.currentTarget); }} onCanPlay={event => { if (event.currentTarget.dataset.trackId === committedTrackId.current) applyPendingLyricSeek(event.currentTarget); }} onSeeked={event => { if (event.currentTarget.dataset.trackId === committedTrackId.current) finishLyricSeek(event.currentTarget); }} onTimeUpdate={event => { const element = event.currentTarget; if (element.dataset.trackId !== committedTrackId.current) return; if (pendingLyricSeek.current !== null && !finishLyricSeek(element)) return; setCurrentTime(element.currentTime); }} onDurationChange={event => { if (event.currentTarget.dataset.trackId !== committedTrackId.current) return; setDuration(event.currentTarget.duration || 0); applyPendingLyricSeek(event.currentTarget); }} onEnded={event => { if (event.currentTarget.dataset.trackId !== committedTrackId.current) return; if (user.playMode === 'loop' && audio.current) { audio.current.currentTime = 0; void audio.current.play(); } else playRelative(1); }}/>
      </section>

      <section className="playlist-panel panel">
        <div className="panel-heading"><h2><span>📜</span>{t.playlist}</h2></div>
        <div className="tabs">{(['results', 'favorites', 'playlists'] as Tab[]).map(value => <button key={value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>{value === 'results' ? t.results : value === 'favorites' ? t.favorites : t.custom}</button>)}</div>
        <div className="playlist-toolbar">
          <strong>{tab === 'results' ? t.results : tab === 'favorites' ? t.favorites : selectedPlaylist?.name || t.custom}</strong>
          {tab === 'playlists' && <div><button title={t.newList} onClick={() => setCreateOpen(true)}>＋</button><button title={t.import} onClick={() => { setImportOpen(true); setImportJob(null); }}>⇩</button><button title={t.backup} onClick={() => void exportBackup()}>⤓</button><label className="icon-upload" title={t.restoreData}>⤒<input type="file" accept="application/json" onChange={event => event.target.files?.[0] && void restoreBackup(event.target.files[0])}/></label>{selectedPlaylist?.source && <button title={t.sync} onClick={() => void syncPlaylist()}>↻</button>}</div>}
        </div>
        <div className="playlist-content">
          {tab === 'results' && (results.length ? results.map(item => <TrackRow key={item.id} item={item} active={current?.id === item.id} pending={pendingTrack?.id === item.id} favorite={favoriteIds.has(item.id)} onPlay={() => void playTrack(item)} onWarm={() => void warmTrack(item)} onFavorite={() => void toggleFavorite(item)} onAdd={() => setAddTrack(item)}/>) : <div className="empty-state"><span>⌁</span><p>{t.empty}</p></div>)}
          {tab === 'favorites' && (favorites.length ? favorites.map(item => <TrackRow key={item.id} item={item} active={current?.id === item.id} pending={pendingTrack?.id === item.id} favorite onPlay={() => void playTrack(item)} onWarm={() => void warmTrack(item)} onFavorite={() => void toggleFavorite(item)} onAdd={() => setAddTrack(item)}/>) : <div className="empty-state"><span>♡</span><p>{t.empty}</p></div>)}
          {tab === 'playlists' && <>{playlists.length ? <div className="playlist-cards">{playlists.map(item => <button key={item.id} className={selectedPlaylist?.id === item.id ? 'active' : ''} onClick={() => void openPlaylist(item)}>{item.coverUrl ? <img src={item.coverUrl} alt=""/> : <span>♫</span>}<b>{item.name}</b><small>{item.trackCount} 首 {item.source ? `· ${sourceNames[item.source]}` : ''}</small></button>)}</div> : <div className="empty-state"><span>＋</span><p>{t.empty}</p></div>}
            {selectedPlaylist && <><input className="playlist-search" value={playlistFilter} onChange={event => setPlaylistFilter(event.target.value)} placeholder={t.searchInList}/><div className="selected-tracks">{visiblePlaylistTracks.map(item => <TrackRow key={item.id} item={item} active={current?.id === item.id} pending={pendingTrack?.id === item.id} favorite={favoriteIds.has(item.id)} draggable onDragStart={() => { draggedTrack.current = item.id; }} onDrop={() => void reorder(item.id)} onPlay={() => void playTrack(item)} onWarm={() => void warmTrack(item)} onFavorite={() => void toggleFavorite(item)} onRemove={() => void removeFromPlaylist(item.id)}/>)}</div></>}
          </>}
        </div>
        <div className="play-modes"><button className={user.playMode === 'list' ? 'active' : ''} title={t.listMode} onClick={() => void setPreference({ playMode: 'list' })}>🔁</button><button className={user.playMode === 'loop' ? 'active' : ''} title={t.loopMode} onClick={() => void setPreference({ playMode: 'loop' })}>🔂</button><button className={user.playMode === 'shuffle' ? 'active' : ''} title={t.shuffleMode} onClick={() => void setPreference({ playMode: 'shuffle' })}>🔀</button><span>{modeLabel}</span></div>
      </section>
    </main>
    <footer>{t.footer}</footer>

    {createOpen && <Modal title={t.newList} onClose={() => setCreateOpen(false)}><label className="modal-label">{t.name}<input autoFocus value={newName} onChange={event => setNewName(event.target.value)} onKeyDown={event => event.key === 'Enter' && void createPlaylist()}/></label><div className="modal-actions"><button className="btn ghost" onClick={() => setCreateOpen(false)}>{t.cancel}</button><button className="btn primary" onClick={() => void createPlaylist()}>{t.create}</button></div></Modal>}
    {importOpen && <Modal title={t.import} onClose={() => setImportOpen(false)} wide><div className="source-pickers">{SOURCES.map(source => <button key={source} className={importSource === source ? 'active' : ''} style={{ '--source-color': sourceColors[source] } as React.CSSProperties} onClick={() => setImportSource(source)}><i/>{sourceNames[source]}</button>)}</div><label className="modal-label">{t.publicLink}<input value={importInput} onChange={event => setImportInput(event.target.value)} placeholder="https://… 或数字 ID"/></label>{importJob && <div className={`import-progress ${importJob.status}`}><div><span style={{ width: `${importJob.progress}%` }}/></div><strong>{importJob.message}</strong><small>{importJob.processed}/{importJob.total || '?'} · {importJob.status}</small>{importJob.failures.length > 0 && <details><summary>失败详情</summary>{importJob.failures.map((item, i) => <p key={i}>{item.track ? `${item.track}: ` : ''}{item.reason}</p>)}</details>}</div>}<div className="modal-actions"><button className="btn ghost" onClick={() => setImportOpen(false)}>{t.close}</button><button className="btn primary" disabled={!importInput.trim() || importJob?.status === 'running'} onClick={() => void startImport()}>{importJob?.status === 'running' ? t.importing : t.startImport}</button></div></Modal>}
    {addTrack && <Modal title={t.add} onClose={() => setAddTrack(null)}><div className="add-list">{playlists.length ? playlists.map(item => <button key={item.id} onClick={() => void addToPlaylist(item.id)}><span>♫</span><b>{item.name}</b><small>{item.trackCount} 首</small></button>) : <p>{t.empty}</p>}</div><div className="modal-actions"><button className="btn ghost" onClick={() => setAddTrack(null)}>{t.cancel}</button><button className="btn primary" onClick={() => { setAddTrack(null); setCreateOpen(true); }}>{t.newList}</button></div></Modal>}
    {accountOpen && <Modal title={t.settings} onClose={() => setAccountOpen(false)}><div className="account-card"><div className="avatar-large">{user.username.slice(0, 1).toUpperCase()}</div><h3>{user.username}</h3><p>{t.accountHint}</p><button className="btn ghost wide" onClick={async () => { const currentPassword = window.prompt('请输入当前密码'); if (!currentPassword) return; const newPassword = window.prompt('请输入新密码（8–72 位）'); if (!newPassword) return; try { await api('/api/auth/password', json('PATCH', { currentPassword, newPassword })); setUser(null); } catch (error) { showToast(error instanceof Error ? error.message : t.failed); } }}>{t.changePassword}</button><button className="btn ghost wide account-logout" onClick={async () => { await api('/api/auth/logout', json('POST')); setUser(null); }}>{t.logout}</button><button className="danger-link" onClick={async () => { const password = window.prompt('请输入当前密码以删除本地账户'); if (!password) return; try { await api('/api/auth/account', json('DELETE', { password })); setUser(null); } catch (error) { showToast(error instanceof Error ? error.message : t.failed); } }}>{t.deleteAccount}</button></div></Modal>}
    {toast && <div className="toast" role="status">⚡ {toast}</div>}
  </div>;
}
