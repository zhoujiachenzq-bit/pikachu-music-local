import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api, json } from './api';
import { QR_SOURCES, PLATFORM_RECOMMEND_SOURCES, PLATFORM_CATEGORY_SOURCES, PLATFORM_PERSONAL_SOURCES, PLATFORM_ALBUM_SOURCES, type PlatformItem, type PlatformQr, type PlatformResult, type QrSource } from '../shared/platform';
import { SOURCE_NAMES, SOURCES, type MusicSource, type Track, type PlaylistDetail, type ResolvedTrack } from '../shared/types';
import './platformPanel.css';
import { useExitGhost } from './motionEffects';
import { phoneApp, phoneCoverUrl } from './phone';
import { Icon } from './ui';

type Result = PlatformResult & { previewId?: string; localAccounts: boolean };
export function PlatformPanel({ onPlay, onSaved, onClose, initialItem, favoriteIds, onFavorite }: { onPlay: (track: Track, queue: Track[]) => void; onSaved: (playlist: PlaylistDetail) => void; onClose: () => void; initialItem?: PlatformItem; favoriteIds: ReadonlySet<string>; onFavorite: (track: Track) => Promise<boolean> }) {
  const [source, setSource] = useState<MusicSource>('netease'); const [type, setType] = useState('playlist'); const [query, setQuery] = useState('');
  const [result, setResult] = useState<Result | null>(null); const [busy, setBusy] = useState(false); const [notice, setNotice] = useState('');
  const [name, setName] = useState('发现的音乐'); const [qrSource, setQrSource] = useState<QrSource>('qq'); const [qr, setQr] = useState<PlatformQr | null>(null); const [qrImage, setQrImage] = useState('');
  const [localAccounts, setLocalAccounts] = useState(false); const generation = useRef(0); const mounted = useRef(true);
  const [mode, setMode] = useState('search');
  const [selected, setSelected] = useState<PlatformItem | null>(null);
  const [collection, setCollection] = useState<Result | null>(null);
  const [savedPlaylist, setSavedPlaylist] = useState<PlaylistDetail | null>(null);
  const saving = useRef(false);
  const [savingPlaylist, setSavingPlaylist] = useState(false);
  const pendingActions = useRef(new Set<string>());
  const [pendingIds, setPendingIds] = useState(new Set<string>());
  const dialog = useRef<HTMLElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  useExitGhost(backdrop);
  useEffect(() => { void browse(initialItem ? 'detail' : 'recommend', initialItem); }, []);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
      if (event.key !== 'Tab') return;
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,a[href],summary') || []).filter(element => element.getClientRects().length > 0);
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { document.removeEventListener('keydown', keydown); previous?.focus(); };
  }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current++; }; }, []);
  useEffect(() => { void api<{ localAccounts: boolean }>('/api/platform/capabilities').then(value => { if (mounted.current) setLocalAccounts(value.localAccounts); }).catch(() => undefined); }, []);
  useEffect(() => {
    let active = true;
    setQrImage('');
    if (qr?.imageUrl) setQrImage(qr.imageUrl);
    else if (qr?.url) void QRCode.toDataURL(qr.url, { width: 240, margin: 2 }).then(value => { if (active) setQrImage(value); });
    if (!qr) return () => { active = false; };
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      if (!active) return;
      if (Date.now() > qr.expiresAt) { setNotice('二维码已过期，请重新获取。'); setQr(null); return; }
      try {
        const state = await api<{ status: string; message: string }>(`/api/platform/login/${qr.session}`);
        if (!active) return;
        setNotice(state.message);
        if (['success', 'expired', 'failed'].includes(state.status)) { setQr(null); return; }
      } catch (error) { if (active) setNotice(error instanceof Error ? error.message : '正在等待登录状态'); }
      if (active) timer = setTimeout(check, 2500);
    };
    timer = setTimeout(check, 2500);
    return () => { active = false; clearTimeout(timer); };
  }, [qr]);

  const browse = async (mode: string, item?: PlatformItem, id?: string) => {
    if (mode === 'search' && type === 'album' && !PLATFORM_ALBUM_SOURCES.includes(source)) { setNotice('此平台暂不支持专辑搜索，请切换音源。'); return; }
    if (mode === 'recommend' && !PLATFORM_RECOMMEND_SOURCES.includes(source) || mode === 'categories' && !PLATFORM_CATEGORY_SOURCES.includes(source) || mode === 'personal' && !PLATFORM_PERSONAL_SOURCES.includes(source)) {
      setNotice('此平台暂不支持该功能，请切换音源。'); return;
    }
    setMode(mode);
    if (item) { setCollection(result); setSelected(item); } else setSelected(null);
    const sequence = ++generation.current; setBusy(true); setNotice(''); setResult(null); setSavedPlaylist(null);
    const params = new URLSearchParams({ mode, source: item?.source || source, type: item?.kind || type, q: query, id: item?.id || id || '' });
    try {
      const data = await api<Result>(`/api/platform/browse?${params}`);
      if (!mounted.current || generation.current !== sequence) return;
      setResult(data); setName((item?.name || query || '发现的音乐').slice(0, 60));
      if (item && item.count > data.tracks.length) setNotice(`平台仅返回 ${data.tracks.length}/${item.count} 首；保存范围以当前列表为准。`);
      if (!data.tracks.length && !data.items.length && !data.categories.length) setNotice('平台未返回结果，可能不支持此功能或需要登录。');
    } catch { if (mounted.current && generation.current === sequence) setNotice(mode === 'personal' ? '暂时无法读取个人歌单，请确认平台账号已登录。' : '暂时没有找到内容，换个关键词或音源试试。'); }
    finally { if (mounted.current && generation.current === sequence) setBusy(false); }
  };
  const save = async () => {
    if (saving.current || savedPlaylist) return;
    if (!result?.previewId) { setNotice('歌曲预览已失效，请重新打开歌单后保存。'); return; }
    if (!name.trim()) { setNotice('请输入歌单名称。'); return; }
    const sequence = generation.current;
    saving.current = true; setSavingPlaylist(true); setNotice('');
    try {
      const data = await api<{ playlist: PlaylistDetail }>('/api/platform/save', json('POST', { previewId: result.previewId, name: name.trim() }));
      if (!data.playlist?.id) throw new Error('未收到保存结果，请重新打开歌单核对。');
      onSaved(data.playlist);
      if (mounted.current && generation.current === sequence) { setSavedPlaylist(data.playlist); setNotice(`已保存歌单「${data.playlist.name}」· ${data.playlist.tracks.length} 首`); }
    }
    catch (error) { setNotice(error instanceof Error ? error.message : '保存失败'); }
    finally { saving.current = false; if (mounted.current) setSavingPlaylist(false); }
  };
  const login = async () => {
    setBusy(true); setQr(null); setNotice('');
    try { const data = await api<PlatformQr>('/api/platform/login', json('POST', { source: qrSource })); if (mounted.current) setQr(data); }
    catch (error) { if (mounted.current) setNotice(error instanceof Error ? error.message : '登录失败'); }
    finally { if (mounted.current) setBusy(false); }
  };
  const trackAction = async (track: Track, action: 'favorite' | 'download') => {
    if (pendingActions.current.has(track.id)) return;
    pendingActions.current.add(track.id); setPendingIds(new Set(pendingActions.current));
    try {
      if (action === 'favorite') { const removing = favoriteIds.has(track.id); if (await onFavorite(track)) setNotice(removing ? '已取消喜欢' : '已加入我的收藏'); return; }
      if (!phoneApp) { window.open(`/api/tracks/${encodeURIComponent(track.id)}/download`, '_blank', 'noopener'); return; }
      const data = await api<{track: ResolvedTrack}>(`/api/tracks/${encodeURIComponent(track.id)}/resolve`, json('POST', {track}));
      const url = new URL(data.track.audioUrl, location.href);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('当前歌曲没有可下载的公开地址。');
      const anchor = document.createElement('a'); anchor.href = url.href; anchor.target = '_blank'; anchor.rel = 'noreferrer'; anchor.download = track.title; anchor.click();
      setNotice('已打开音频地址，请在浏览器中保存。');
    } catch (error) { if (mounted.current) setNotice(error instanceof Error ? error.message : '操作失败，请重试'); }
    finally { pendingActions.current.delete(track.id); if (mounted.current) setPendingIds(new Set(pendingActions.current)); }
  };
  return <div ref={backdrop} className="modal-backdrop platform-backdrop" onClick={onClose}><section ref={dialog} tabIndex={-1} className="modal-card platform-panel" role="dialog" aria-modal="true" aria-labelledby="platform-title" onClick={event => event.stopPropagation()}>
    <header className="platform-header"><div className="platform-heading"><span className="platform-heading-icon"><Icon name="library" size={25}/></span><h2 id="platform-title">发现音乐</h2></div><button className="platform-close" aria-label="关闭发现音乐" onClick={onClose}><Icon name="close" size={22}/></button></header>
    <div className="platform-body">
    <form onSubmit={event => { event.preventDefault(); void browse(/^https?:/.test(query.trim()) ? 'link' : 'search'); }}>
      <div className="platform-controls"><div className="platform-type-switch" role="group" aria-label="搜索类型">{[['playlist', '歌单'], ['album', '专辑'], ['song', '歌曲']].map(([value, label]) => <button type="button" key={value} disabled={value === 'album' && !PLATFORM_ALBUM_SOURCES.includes(source)} aria-pressed={type === value} className={type === value ? 'active' : ''} onClick={() => setType(value)}>{label}</button>)}</div><label className="platform-source"><span>音源</span><select aria-label="音乐平台" value={source} onChange={event => { generation.current++; setBusy(false); setSource(event.target.value as MusicSource); if (type === 'album' && !PLATFORM_ALBUM_SOURCES.includes(event.target.value as MusicSource)) setType('playlist'); setResult(null); setSelected(null); setNotice(''); }}>{SOURCES.map(source => <option key={source} value={source}>{SOURCE_NAMES[source]}</option>)}</select></label></div>
      <div className="platform-query"><Icon name="search" size={20}/><input aria-label="关键词或分享链接" value={query} onChange={event => setQuery(event.target.value)} placeholder="关键词或分享链接"/><button className="btn primary" disabled={busy || !query.trim()}>{busy ? '查找中' : '搜索'}</button></div>
    </form>
    <nav className="platform-nav" aria-label="发现方式"><button className={mode === 'recommend' ? 'active' : ''} aria-pressed={mode === 'recommend'} disabled={busy || !PLATFORM_RECOMMEND_SOURCES.includes(source)} onClick={() => void browse('recommend')}><Icon name="sparkles" size={17}/>为你发现</button><button className={['categories', 'category'].includes(mode) ? 'active' : ''} aria-pressed={['categories', 'category'].includes(mode)} disabled={busy || !PLATFORM_CATEGORY_SOURCES.includes(source)} onClick={() => void browse('categories')}><Icon name="library" size={17}/>分类浏览</button>{localAccounts && <button className={mode === 'personal' ? 'active' : ''} aria-pressed={mode === 'personal'} disabled={busy || !PLATFORM_PERSONAL_SOURCES.includes(source)} onClick={() => void browse('personal')}><Icon name="heart" size={17}/>我的平台歌单</button>}</nav>
    {localAccounts && <details><summary>平台账号 · 仅保存在本机</summary><div className="platform-login"><select aria-label="登录平台" value={qrSource} onChange={event => { setQr(null); setQrSource(event.target.value as QrSource); }}>{QR_SOURCES.map(source => <option key={source} value={source}>{source === 'qq_wx' ? 'QQ 微信登录' : SOURCE_NAMES[source]}</option>)}</select><button className="btn ghost" disabled={busy} onClick={() => void login()}>获取登录码</button><button className="btn ghost" disabled={busy} onClick={async () => { try { await api('/api/platform/logout', json('POST', { source: qrSource })); setQr(null); setNotice('已退出该平台账号。'); } catch (error) { setNotice(error instanceof Error ? error.message : '退出失败'); } }}>退出平台</button></div>{qr && <div className="platform-qr">{qrImage && <img src={qrImage} alt="平台登录二维码"/>}<p>用平台 App 扫码并确认。也可用另一台设备扫描本屏。</p>{qr.url && <a href={qr.url} target="_blank" rel="noreferrer">打开官方登录链接</a>}<button className="btn ghost" onClick={() => setQr(null)}>取消等待</button></div>}</details>}
    {(busy || notice) && <p className="platform-notice" role="status">{busy ? '加载中…' : notice}</p>}
    {busy && !result && <div className="platform-skeleton" aria-hidden="true">{[0,1,2,3].map(item => <div key={item}><span/><i/><i/></div>)}</div>}
    {selected && !busy && <div className="platform-detail-heading"><button className="platform-back" onClick={() => { generation.current++; setResult(collection); setSelected(null); setNotice(''); setMode('search'); }}><Icon name="previous" size={16}/>返回列表</button><div><small>{SOURCE_NAMES[selected.source]} · {selected.kind === 'album' ? '专辑' : '歌单'}</small><h3>{selected.name}</h3>{selected.description && <p>{selected.description}</p>}</div></div>}
    {!!result?.items.length && <div className="platform-results-heading"><h3>{mode === 'recommend' ? '平台推荐' : mode === 'personal' ? '个人歌单' : '搜索结果'}</h3><span>{result.items.length} {type === 'album' ? '张专辑' : '张歌单'}</span></div>}
    {!!result?.categories.length && <div className="platform-categories">{result.categories.map(category => <button className="btn ghost" key={category.id} onClick={() => void browse('category', undefined, category.id)}>{category.name}</button>)}</div>}
    <div className="platform-collections">{result?.items.map(item => <button key={`${item.source}:${item.kind}:${item.id}`} onClick={() => void browse('detail', item)}><CollectionCover item={item}/><strong>{item.name}</strong><small>{SOURCE_NAMES[item.source]}{item.count > 0 ? ` · ${item.count} 首` : ''}</small></button>)}</div>
    {!!result?.tracks.length && <>
      <div className="platform-save">
        <label><span>歌单名称 · {result.tracks.length} 首</span><input aria-label="保存的歌单名称" maxLength={60} value={name} disabled={savingPlaylist || !!savedPlaylist} onChange={event => setName(event.target.value)}/></label>
        <button className="btn primary" disabled={busy || savingPlaylist || !!savedPlaylist || !name.trim()} onClick={() => void save()}><Icon name="library" size={18}/>{savingPlaylist ? '保存中…' : savedPlaylist ? '已保存歌单' : '保存歌单'}</button>
        {savedPlaylist && <button className="btn ghost" onClick={onClose}>查看歌单</button>}
        <button className="btn ghost" onClick={() => onPlay(result.tracks[0], [...result.tracks])}><Icon name="play" size={16}/>播放全部</button>
      </div>
      <ol className="platform-tracks">{result.tracks.map(track => <li key={track.id}>
        <PlatformTrackCover track={track}/><button className="platform-track-title" onClick={() => onPlay(track, [...result.tracks])}><strong>{track.title}</strong><small>{track.artist} · {SOURCE_NAMES[track.source]}</small></button>
        <button className={`platform-track-action ${favoriteIds.has(track.id) ? 'is-liked' : ''}`} aria-label={`${favoriteIds.has(track.id) ? '取消喜欢' : '喜欢'} ${track.title}`} title={favoriteIds.has(track.id) ? '取消喜欢' : '喜欢'} aria-pressed={favoriteIds.has(track.id)} disabled={pendingIds.has(track.id)} onClick={() => void trackAction(track, 'favorite')}><Icon name="heart" size={22} filled={favoriteIds.has(track.id)}/></button>
        <button className="platform-track-action" aria-label={`下载 ${track.title}`} title="下载" disabled={pendingIds.has(track.id)} onClick={() => void trackAction(track, 'download')}><Icon name="download" size={22}/></button>
      </li>)}</ol>
    </>}
    </div>
  </section></div>;
}

function CollectionCover({ item }: { item: PlatformItem }) {
  const [broken, setBroken] = useState(false);
  return <span className={`platform-collection-art ${item.kind === 'album' ? 'is-album' : ''}`}>{item.cover && !broken ? <img src={item.cover} alt="" loading="lazy" onError={() => setBroken(true)}/> : <Icon name="music" size={38}/>}<span className="platform-collection-play"><Icon name="play" size={20}/></span></span>;
}

function PlatformTrackCover({ track }: { track: Track }) {
  const [failed, setFailed] = useState(false);
  const [proxy, setProxy] = useState(false);
  const proxyUrl = phoneCoverUrl(track.source, track.sourceTrackId) || `/api/platform/cover?id=${encodeURIComponent(track.id)}`;
  return failed ? <span className="platform-track-cover">♫</span> : <img className="platform-track-cover" src={proxy || !track.coverUrl ? proxyUrl : track.coverUrl} alt="" loading="lazy" onError={() => { if (proxy || !track.coverUrl) setFailed(true); else setProxy(true); }}/>;
}
