import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, json } from './api';
import { streamAgentMessage } from './agentStream';
import { decryptAgentArchive, encryptAgentArchive, type EncryptedAgentArchive } from './agentArchiveCrypto';
import { Icon } from './ui';
import { AgentAdminPanel } from './AgentAdminPanel';
import type { AgentAccess, AgentClientAction, AgentClientActionResult, AgentClientContext, AgentConversation, AgentMemory, AgentMessage, AgentSettings, AgentStreamEvent, Track } from '../shared/types';

interface ReasonCard { id: string; title: string; body: string; tracks: Track[]; }
interface CitationCard { title: string; url?: string; kind: 'web' | 'knowledge'; detail?: string; }
interface PendingAction { actionId: string; tool: string; summary: string; input: unknown; expiresAt: string; status?: string; }
interface ActionReceipt { actionId: string; message: string; undoAction?: AgentClientAction; status: 'ready' | 'undoing' | 'undone' | 'failed'; }
interface KnowledgeVersionCard { id: string; kind: string; status: string; source: string; collectedAt: string; itemCount: number; checksum: string; createdAt: string; activatedAt: string | null; embeddedCount: number; embeddingRemaining: number; }
interface KnowledgeSample { id: string; title: string; artist: string; content: string; sourceUrl: string | null; metadata: Record<string, unknown>; }
interface TrendUpdateRun { id: string; source: string; mode: string; status: string; startedAt: string; completedAt: string | null; itemCount: number; versionId: string | null; message: string; }
interface TrendStatus { schedule: { timezone: string; expression: string; computerTaskRequired: boolean }; configuration: { douyin: boolean; publish: boolean; qishuiSnapshot: boolean }; activeVersion: { id: string; source: string; collectedAt: string; itemCount: number; activatedAt: string | null } | null; runs: TrendUpdateRun[]; }
interface AgentPanelProps {
  userId: string;
  lang: 'zh' | 'en';
  open: boolean;
  mobile: boolean;
  context: AgentClientContext;
  initialPrompt?: string;
  onClose: () => void;
  onAction: (action: AgentClientAction) => Promise<AgentClientActionResult>;
  onSpeechState?: (speaking: boolean) => void;
  onProactivePreferenceChange?: (enabled: boolean) => void;
}

const introKey = (userId: string) => `pikachu:agent-intro:v1:${userId}`;
type MemoryFilter = 'all' | AgentMemory['category'];
const memoryFilters: MemoryFilter[] = ['all', 'preference', 'person', 'plan', 'event', 'context'];
const memoryLabel = (filter: MemoryFilter, zh: boolean) => zh
  ? ({ all: '全部', preference: '偏好', person: '关于我', plan: '计划', event: '经历', context: '近期' } as const)[filter]
  : ({ all: 'All', preference: 'Taste', person: 'About me', plan: 'Plans', event: 'Events', context: 'Recent' } as const)[filter];
const memoryExpiry = (value: string | null, zh: boolean) => {
  if (!value) return zh ? '长期保留' : 'Long term'; const hours = Math.max(1, Math.ceil((Date.parse(value) - Date.now()) / 3_600_000));
  return hours < 48 ? (zh ? `${hours} 小时后失效` : `Expires in ${hours}h`) : (zh ? `${Math.ceil(hours / 24)} 天后失效` : `Expires in ${Math.ceil(hours / 24)}d`);
};
const messageCitations = (message: AgentMessage): CitationCard[] => Array.isArray(message.metadata?.citations)
  ? (message.metadata.citations as unknown[]).flatMap(value => {
    if (!value || typeof value !== 'object') return []; const item = value as Record<string, unknown>;
    if (typeof item.title !== 'string') return [];
    return [{ title: item.title, url: typeof item.url === 'string' ? item.url : undefined, kind: item.kind === 'web' ? 'web' : 'knowledge', detail: typeof item.detail === 'string' ? item.detail : undefined }];
  }) : [];

export function AgentPanel({ userId, lang, open, mobile, context, initialPrompt, onClose, onAction, onSpeechState, onProactivePreferenceChange }: AgentPanelProps) {
  const zh = lang === 'zh';
  const [access, setAccess] = useState<AgentAccess | null>(null); const [settings, setSettings] = useState<AgentSettings | null>(null);
  const [conversation, setConversation] = useState<AgentConversation | null>(null); const [mainConversation, setMainConversation] = useState<AgentConversation | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([]); const [input, setInput] = useState(''); const [streaming, setStreaming] = useState(false);
  const [webSearch, setWebSearch] = useState(false); const [reasonCards, setReasonCards] = useState<ReasonCard[]>([]); const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const [actionReceipts, setActionReceipts] = useState<ActionReceipt[]>([]);
  const [recording, setRecording] = useState(false); const [transcribing, setTranscribing] = useState(false); const [speakingMessageId, setSpeakingMessageId] = useState<string | null>(null);
  const [inviteCode, setInviteCode] = useState(''); const [error, setError] = useState(''); const [settingsOpen, setSettingsOpen] = useState(false);
  const [memoriesOpen, setMemoriesOpen] = useState(false); const [memories, setMemories] = useState<AgentMemory[]>([]);
  const [memoryFilter, setMemoryFilter] = useState<MemoryFilter>('all');
  const [knowledgeOpen, setKnowledgeOpen] = useState(false); const [knowledgeVersions, setKnowledgeVersions] = useState<KnowledgeVersionCard[]>([]); const [knowledgeSample, setKnowledgeSample] = useState<KnowledgeSample[]>([]);
  const [knowledgeQuery, setKnowledgeQuery] = useState(''); const [knowledgeBusy, setKnowledgeBusy] = useState(false); const [embeddingConfigured, setEmbeddingConfigured] = useState(false);
  const [trendStatus, setTrendStatus] = useState<TrendStatus | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const [introOpen, setIntroOpen] = useState(() => window.localStorage.getItem(introKey(userId)) !== 'seen');
  const generation = useRef(0); const streamController = useRef<AbortController | null>(null); const scroller = useRef<HTMLDivElement>(null);
  const streamText = useRef(''); const recorder = useRef<MediaRecorder | null>(null); const recorderStream = useRef<MediaStream | null>(null); const recorderChunks = useRef<Blob[]>([]); const recordingStartedAt = useRef(0); const recordingTimer = useRef<number | null>(null); const speechAudio = useRef<HTMLAudioElement | null>(null); const receiptTimers = useRef(new Map<string, number>());

  const load = useCallback(async () => {
    setError('');
    try {
      const root = await api<{ access: AgentAccess; settings: AgentSettings }>('/api/agent/access'); setAccess(root.access); setSettings(root.settings);
      if (!root.access.enabled || !root.access.entitled || !root.access.configured) return;
      const data = await api<{ conversation: AgentConversation; messages: AgentMessage[] }>('/api/agent/conversations/main');
      setMainConversation(data.conversation); setConversation(current => current?.kind === 'temporary' ? current : data.conversation);
      if (!conversation || conversation.kind === 'main') setMessages(data.messages);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '珍奇暂时无法连接。'); }
  }, [conversation?.kind]);

  useEffect(() => { if (open) void load(); }, [open, userId]);
  useEffect(() => { if (open && initialPrompt) setInput(value => value || initialPrompt); }, [initialPrompt, open]);
  useEffect(() => { requestAnimationFrame(() => { if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight; }); }, [messages, reasonCards, streaming]);
  const stopSpeech = useCallback(() => {
    if (speechAudio.current) { speechAudio.current.pause(); if (speechAudio.current.src.startsWith('blob:')) URL.revokeObjectURL(speechAudio.current.src); speechAudio.current = null; }
    window.speechSynthesis?.cancel(); setSpeakingMessageId(null); onSpeechState?.(false);
  }, [onSpeechState]);
  useEffect(() => () => { streamController.current?.abort(); if (recordingTimer.current !== null) window.clearTimeout(recordingTimer.current); receiptTimers.current.forEach(timer => window.clearTimeout(timer)); receiptTimers.current.clear(); recorder.current?.stop(); recorderStream.current?.getTracks().forEach(track => track.stop()); stopSpeech(); }, [stopSpeech]);

  const reportAction = async (actionId: string, result: AgentClientActionResult) => {
    await api(`/api/agent/actions/${actionId}/result`, json('POST', { ok: result.ok, message: result.message, details: { undoAvailable: Boolean(result.undoAction) } })).catch(() => undefined);
  };

  const removeReceiptLater = (actionId: string, delay = 20_000) => {
    const previous = receiptTimers.current.get(actionId); if (previous !== undefined) window.clearTimeout(previous);
    receiptTimers.current.set(actionId, window.setTimeout(() => { receiptTimers.current.delete(actionId); setActionReceipts(value => value.filter(item => item.actionId !== actionId)); }, delay));
  };

  const addActionReceipt = (actionId: string, result: AgentClientActionResult) => {
    if (!result.ok) return;
    const receipt: ActionReceipt = { actionId, message: result.message || '操作已完成', undoAction: result.undoAction, status: 'ready' };
    setActionReceipts(value => [...value.filter(item => item.actionId !== actionId), receipt].slice(-3)); removeReceiptLater(actionId);
  };

  const undoReceipt = async (receipt: ActionReceipt) => {
    if (!receipt.undoAction || receipt.status === 'undoing' || receipt.status === 'undone') return;
    const timer = receiptTimers.current.get(receipt.actionId); if (timer !== undefined) window.clearTimeout(timer);
    setActionReceipts(value => value.map(item => item.actionId === receipt.actionId ? { ...item, status: 'undoing' } : item));
    const result = await onAction(receipt.undoAction);
    if (result.ok) await api(`/api/agent/actions/${receipt.actionId}/undo-result`, json('POST', { ok: true, message: result.message })).catch(() => undefined);
    setActionReceipts(value => value.map(item => item.actionId === receipt.actionId ? { ...item, status: result.ok ? 'undone' : 'failed', message: result.ok ? `已撤销 · ${result.message || '已恢复原状态'}` : (result.message || '撤销没有完成') } : item));
    removeReceiptLater(receipt.actionId, result.ok ? 3200 : 12_000);
  };

  const readText = async (text: string, messageId: string) => {
    const clean = text.trim(); if (!clean) return; if (speakingMessageId === messageId) { stopSpeech(); return; }
    stopSpeech(); setSpeakingMessageId(messageId); onSpeechState?.(true);
    const fallback = () => {
      if (!('speechSynthesis' in window)) { setError('当前浏览器不能朗读这段文字。'); stopSpeech(); return; }
      const utterance = new SpeechSynthesisUtterance(clean); utterance.lang = zh ? 'zh-CN' : 'en-US'; utterance.rate = settings?.persona === 'bright' ? 1.06 : settings?.persona === 'poetic' ? .93 : 1;
      utterance.onend = stopSpeech; utterance.onerror = stopSpeech; window.speechSynthesis.speak(utterance);
    };
    try {
      const response = await fetch('/api/agent/voice/synthesize', json('POST', { text: clean.slice(0, 1500), voice: settings?.voice || 'Cherry', persona: settings?.persona || 'warm' }));
      if (!response.ok) { fallback(); return; }
      const url = URL.createObjectURL(await response.blob()); const audioElement = new Audio(url); speechAudio.current = audioElement; audioElement.onended = stopSpeech; audioElement.onerror = fallback; await audioElement.play();
    } catch { fallback(); }
  };

  const handleEvent = async (event: AgentStreamEvent, draftId: string, activeGeneration: number) => {
    if (activeGeneration !== generation.current) return;
    if (event.type === 'text_delta') { streamText.current += event.delta; setMessages(value => value.map(message => message.id === draftId ? { ...message, content: message.content + event.delta } : message)); }
    else if (event.type === 'reason_card') setReasonCards(value => [...value, { id: crypto.randomUUID(), title: event.title, body: event.body, tracks: event.tracks || [] }]);
    else if (event.type === 'citation') setMessages(value => value.map(message => {
      if (message.id !== draftId) return message; const citations = messageCitations(message); const incoming: CitationCard = { title: event.title, url: event.url, kind: event.kind || 'web', detail: event.detail };
      if (citations.some(item => item.kind === incoming.kind && item.title === incoming.title && item.url === incoming.url)) return message;
      return { ...message, metadata: { ...message.metadata, citations: [...citations, incoming] } };
    }));
    else if (event.type === 'action_required') setPendingActions(value => [...value, { ...event }]);
    else if (event.type === 'client_action') {
      const result = await onAction(event.action); await reportAction(event.actionId, result);
      if (!result.ok) setError(result.message || '播放器没有完成这次操作。'); else addActionReceipt(event.actionId, result);
    } else if (event.type === 'done') { setMessages(value => value.map(message => message.id === draftId ? { ...message, id: event.messageId } : message)); if (settings?.autoRead && streamText.current.trim()) void readText(streamText.current, event.messageId); }
    else if (event.type === 'error') setError(event.message);
  };

  const send = async (event?: FormEvent, preset?: string) => {
    event?.preventDefault(); const text = (preset ?? input).trim(); if (!text || !conversation) return;
    const activeGeneration = ++generation.current; streamController.current?.abort(); const controller = new AbortController(); streamController.current = controller;
    const stamp = new Date().toISOString(); const userDraft: AgentMessage = { id: `local-user-${activeGeneration}`, conversationId: conversation.id, role: 'user', content: text, createdAt: stamp };
    const assistantDraft: AgentMessage = { id: `local-assistant-${activeGeneration}`, conversationId: conversation.id, role: 'assistant', content: '', createdAt: stamp };
    streamText.current = ''; setMessages(value => [...value, userDraft, assistantDraft]); setInput(''); setError(''); setStreaming(true); const thisWebSearch = webSearch; setWebSearch(false);
    try { await streamAgentMessage({ conversationId: conversation.id, message: text, generation: activeGeneration, webSearch: thisWebSearch, context }, streamEvent => { void handleEvent(streamEvent, assistantDraft.id, activeGeneration); }, controller.signal); }
    catch (cause) { if (!controller.signal.aborted) { setError(cause instanceof Error ? cause.message : '珍奇暂时无法连接。'); setMessages(value => value.filter(message => message.id !== assistantDraft.id || message.content)); } }
    finally { if (activeGeneration === generation.current) setStreaming(false); }
  };

  const stopRecording = () => { if (recordingTimer.current !== null) { window.clearTimeout(recordingTimer.current); recordingTimer.current = null; } if (recorder.current?.state === 'recording') recorder.current.stop(); };
  const toggleRecording = async () => {
    if (recording) { stopRecording(); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setError('当前浏览器不支持语音输入。'); return; }
    try {
      setError(''); const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true }); recorderStream.current = mediaStream; recorderChunks.current = [];
      const preferred = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(value => MediaRecorder.isTypeSupported(value)); const mediaRecorder = new MediaRecorder(mediaStream, preferred ? { mimeType: preferred } : undefined); recorder.current = mediaRecorder; recordingStartedAt.current = Date.now();
      mediaRecorder.ondataavailable = event => { if (event.data.size) recorderChunks.current.push(event.data); };
      mediaRecorder.onstop = async () => {
        setRecording(false); mediaStream.getTracks().forEach(track => track.stop()); recorderStream.current = null; recorder.current = null; const chunks = recorderChunks.current.splice(0); if (!chunks.length) return;
        const mimeType = mediaRecorder.mimeType || chunks[0]?.type || 'audio/webm'; const durationSeconds = Math.min(60, Math.max(.1, (Date.now() - recordingStartedAt.current) / 1000)); const blob = new Blob(chunks, { type: mimeType }); setTranscribing(true);
        try { const buffer = new Uint8Array(await blob.arrayBuffer()); let binary = ''; for (let offset = 0; offset < buffer.length; offset += 0x8000) binary += String.fromCharCode(...buffer.subarray(offset, offset + 0x8000)); const result = await api<{ text: string }>('/api/agent/voice/transcribe', json('POST', { audioBase64: btoa(binary), mimeType, durationSeconds })); setInput(value => value ? `${value} ${result.text}` : result.text); }
        catch (cause) { setError(cause instanceof Error ? cause.message : '这段录音没有识别成功。'); }
        finally { setTranscribing(false); }
      };
      mediaRecorder.start(250); setRecording(true); recordingTimer.current = window.setTimeout(stopRecording, 60_000);
    } catch (cause) { recorderStream.current?.getTracks().forEach(track => track.stop()); setRecording(false); setError(cause instanceof Error ? cause.message : '没有获得麦克风权限。'); }
  };

  const startTemporary = async () => {
    streamController.current?.abort();
    const data = await api<{ conversation: AgentConversation; messages: AgentMessage[] }>('/api/agent/conversations/temporary', json('POST'));
    setConversation(data.conversation); setMessages([]); setReasonCards([]); setPendingActions([]); setActionReceipts([]); setSettingsOpen(false); setMemoriesOpen(false); setKnowledgeOpen(false);
  };
  const leaveTemporary = async () => {
    if (conversation?.kind === 'temporary') await api(`/api/agent/conversations/${conversation.id}`, json('DELETE'));
    if (mainConversation) { setConversation(mainConversation); setActionReceipts([]); const data = await api<{ messages: AgentMessage[] }>(`/api/agent/conversations/${mainConversation.id}/messages`); setMessages(data.messages); }
  };
  const redeem = async () => {
    try { await api('/api/agent/invites/redeem', json('POST', { code: inviteCode })); setInviteCode(''); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '邀请码无效。'); }
  };
  const updateSettings = async (patch: Partial<AgentSettings>) => {
    if (!settings) return; const previous = settings; setSettings({ ...settings, ...patch });
    try { const result = await api<{ settings: AgentSettings }>('/api/agent/settings', json('PATCH', patch)); setSettings(result.settings); if (patch.proactiveEnabled !== undefined) onProactivePreferenceChange?.(patch.proactiveEnabled); }
    catch (cause) { setSettings(previous); setError(cause instanceof Error ? cause.message : '设置保存失败。'); }
  };
  const openMemories = async () => {
    try { const result = await api<{ memories: AgentMemory[] }>('/api/agent/memories'); setMemories(result.memories); setMemoryFilter('all'); setMemoriesOpen(true); setKnowledgeOpen(false); setSettingsOpen(false); setAdminOpen(false); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '记忆读取失败。'); }
  };
  const loadKnowledge = async (query = knowledgeQuery) => {
    setKnowledgeBusy(true);
    try {
      const [result, trends] = await Promise.all([
        api<{ versions: KnowledgeVersionCard[]; sample: KnowledgeSample[]; embeddingConfigured: boolean }>(`/api/admin/agent/knowledge?q=${encodeURIComponent(query.trim())}`),
        api<TrendStatus>('/api/admin/agent/trends/status')
      ]);
      setKnowledgeVersions(result.versions); setKnowledgeSample(result.sample); setEmbeddingConfigured(result.embeddingConfigured); setError('');
      setTrendStatus(trends);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '知识状态读取失败。'); }
    finally { setKnowledgeBusy(false); }
  };
  const openKnowledge = async () => { setKnowledgeOpen(true); setMemoriesOpen(false); setSettingsOpen(false); setAdminOpen(false); await loadKnowledge(''); };
  const activateKnowledge = async (version: KnowledgeVersionCard) => {
    if (!window.confirm(`切换到知识版本“${version.source}”？播放器和用户数据不会改变。`)) return;
    try { await api(`/api/admin/agent/knowledge/${version.id}/activate`, json('POST')); await loadKnowledge(knowledgeQuery); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '知识版本切换失败。'); }
  };
  const fillKnowledgeEmbeddings = async (version: KnowledgeVersionCard) => {
    setKnowledgeBusy(true);
    try {
      const result = await api<{ completed: number; failed: number; remaining: boolean }>(`/api/admin/agent/knowledge/${version.id}/embeddings`, json('POST', { limit: 20 }));
      setError(result.failed ? `完成 ${result.completed} 条，${result.failed} 条暂时失败。` : `已补全 ${result.completed} 条知识向量。`); await loadKnowledge(knowledgeQuery);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '知识向量补全失败。'); setKnowledgeBusy(false); }
  };
  const rehearseTrendPipeline = async () => {
    setKnowledgeBusy(true);
    try { const result = await api<{ rehearsal: { itemCount: number; duplicateCount: number; derivativeCount: number }; runs: TrendUpdateRun[] }>('/api/admin/agent/trends/rehearse', json('POST')); setError(`演练通过：${result.rehearsal.itemCount} 条有效记录，合并 ${result.rehearsal.duplicateCount} 条重复项。正式知识未改变。`); await loadKnowledge(knowledgeQuery); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '趋势流水线演练失败。'); setKnowledgeBusy(false); }
  };
  const editMemory = async (memory: AgentMemory) => {
    const content = window.prompt('修改这条记忆', memory.content)?.trim(); if (!content || content === memory.content) return;
    try { const result = await api<{ memory: AgentMemory }>(`/api/agent/memories/${memory.id}`, json('PATCH', { content })); setMemories(value => value.map(item => item.id === memory.id ? result.memory : item)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '记忆修改失败。'); }
  };
  const removeMemory = async (memory: AgentMemory) => {
    if (!window.confirm(`删除“${memory.content}”？`)) return; await api(`/api/agent/memories/${memory.id}`, json('DELETE')); setMemories(value => value.filter(item => item.id !== memory.id));
  };
  const exportArchive = async () => {
    const password = window.prompt('为珍奇档案设置密码（至少 8 位）。服务端不会保存这个密码。'); if (!password) return;
    const confirmation = window.prompt('再次输入档案密码'); if (password !== confirmation) { setError('两次输入的档案密码不一致。'); return; }
    try {
      const plain = await api<unknown>('/api/agent/archive/export'); const encrypted = await encryptAgentArchive(plain, password); const blob = new Blob([JSON.stringify(encrypted, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `zhenqi-archive-${new Date().toISOString().slice(0, 10)}.json`; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '档案导出失败。'); }
  };
  const restoreArchive = async (file: File) => {
    const password = window.prompt('输入珍奇档案密码'); if (!password) return;
    try { const encrypted = JSON.parse(await file.text()) as EncryptedAgentArchive; const plain = await decryptAgentArchive(encrypted, password); const result = await api<{ merged: { messages: number; memories: number } }>('/api/agent/archive/restore', json('POST', plain)); setError(`已合并 ${result.merged.messages} 条对话和 ${result.merged.memories} 条记忆。`); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '档案恢复失败。'); }
  };
  const resolvePending = async (item: PendingAction, confirm: boolean) => {
    try {
      const result = await api<{ message?: string; clientAction?: AgentClientAction }>(`/api/agent/actions/${item.actionId}/${confirm ? 'confirm' : 'cancel'}`, json('POST'));
      if (result.clientAction) { const executed = await onAction(result.clientAction); await reportAction(item.actionId, executed); if (!executed.ok) throw new Error(executed.message || '操作没有完成。'); }
      setPendingActions(value => value.map(action => action.actionId === item.actionId ? { ...action, status: confirm ? (result.message || '已确认') : '已取消' } : action));
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : '操作状态更新失败。'); }
  };

  const shellClass = `agent-panel ${mobile ? 'agent-panel-mobile' : 'agent-panel-center'} ${open ? 'open' : ''}`;
  const visibleMemories = memoryFilter === 'all' ? memories : memories.filter(memory => memory.category === memoryFilter);
  const memoryStats = { explicit: memories.filter(memory => !memory.inferred).length, inferred: memories.filter(memory => memory.inferred).length, temporary: memories.filter(memory => Boolean(memory.expiresAt)).length };
  if (!open) return null;
  return <aside className={shellClass} aria-label={zh ? '珍奇音乐知己' : 'Zhenqi music companion'}>
    <header className="agent-header">
      <div className="agent-wordmark"><span className="agent-pulse"><i/><i/><i/></span><div><small>MUSIC COMPANION · BETA</small><strong>{settings?.assistantName || '珍奇'}</strong></div></div>
      <div className="agent-header-actions"><button className="agent-action-temporary" aria-label={zh ? '切换临时对话' : 'Toggle temporary chat'} aria-pressed={conversation?.kind === 'temporary'} title={zh ? '临时对话：不形成长期记忆' : 'Temporary chat: no long-term memory'} onClick={() => void (conversation?.kind === 'temporary' ? leaveTemporary() : startTemporary())}><Icon name="temporary" size={18}/></button><button className="agent-action-settings" aria-label={zh ? '珍奇设置' : 'Zhenqi settings'} aria-pressed={settingsOpen} title={zh ? '珍奇设置' : 'Zhenqi settings'} onClick={() => { setSettingsOpen(value => !value); setMemoriesOpen(false); setKnowledgeOpen(false); setAdminOpen(false); }}><Icon name="settings" size={18}/></button>{!mobile && <button className="agent-action-return" aria-label={zh ? '返回播放器' : 'Return to player'} title={zh ? '返回播放器' : 'Return to player'} onClick={onClose}><Icon name="return" size={18}/></button>}</div>
    </header>
    {conversation?.kind === 'temporary' && <div className="agent-temporary-banner"><Icon name="temporary" size={15}/><span>{zh ? '临时对话：不形成长期记忆，关闭即删除。' : 'Temporary: no long-term memory; deleted when closed.'}</span><button onClick={() => void leaveTemporary()}>{zh ? '返回主对话' : 'Back'}</button></div>}
    {introOpen && <section className="agent-intro">
      <span className="agent-intro-index">01 / PRIVACY</span><h2>{zh ? '珍奇只看完成这次请求所需的信息。' : 'Zhenqi sees only what this request needs.'}</h2>
      <p>{zh ? '当前歌曲、队列和你的音乐偏好会帮助推荐；对话会加密保存 90 天。密码、令牌、完整日志和其他用户数据永远不会交给模型。你可以随时暂停或清空记忆。' : 'Current playback and music preferences can shape recommendations. Chats are encrypted and retained for 90 days; credentials and other users’ data are never shared.'}</p>
      <button className="btn primary" onClick={() => { window.localStorage.setItem(introKey(userId), 'seen'); setIntroOpen(false); }}>{zh ? '明白，唤醒珍奇' : 'Wake Zhenqi'}</button>
    </section>}
    {!introOpen && settingsOpen && settings && <section className="agent-settings">
      <label>{zh ? '称呼' : 'Name'}<input value={settings.assistantName} onChange={event => setSettings({ ...settings, assistantName: event.target.value })} onBlur={() => void updateSettings({ assistantName: settings.assistantName })}/></label>
      <div><span>{zh ? '性格' : 'Persona'}</span>{(['warm', 'bright', 'poetic'] as const).map(persona => <button key={persona} className={settings.persona === persona ? 'active' : ''} onClick={() => void updateSettings({ persona })}>{persona === 'warm' ? '温暖机灵' : persona === 'bright' ? '活泼治愈' : '克制诗意'}</button>)}</div>
      <label className="agent-toggle"><input type="checkbox" checked={settings.memoryEnabled} onChange={event => void updateSettings({ memoryEnabled: event.target.checked })}/><span>{zh ? '允许使用与记录长期记忆' : 'Use and save long-term memory'}</span></label>
      <label className="agent-toggle"><input type="checkbox" checked={settings.proactiveEnabled} onChange={event => void updateSettings({ proactiveEnabled: event.target.checked })}/><span>{zh ? '允许克制的主动陪伴（每日最多两次）' : 'Allow quiet proactive check-ins (max twice daily)'}</span></label>
      <label className="agent-toggle"><input type="checkbox" checked={settings.autoRead} onChange={event => void updateSettings({ autoRead: event.target.checked })}/><span>{zh ? '自动朗读珍奇回复' : 'Read replies aloud'}</span></label>
      <label>{zh ? '音色' : 'Voice'}<span className="agent-voice-controls"><select value={settings.voice} onChange={event => void updateSettings({ voice: event.target.value })}><option value="Cherry">Cherry</option><option value="Serena">Serena</option><option value="Ethan">Ethan</option><option value="Chelsie">Chelsie</option></select><button type="button" onClick={() => void readText(zh ? '你好，我是珍奇。今晚想听点什么？' : 'Hi, I am Zhenqi. What would you like to hear?', 'voice-preview')}>{speakingMessageId === 'voice-preview' ? (zh ? '停止' : 'Stop') : (zh ? '试听' : 'Preview')}</button></span></label>
      <div className="agent-data-actions"><button onClick={() => void openMemories()}>{zh ? '珍奇知道的我' : 'What Zhenqi knows'}</button>{access?.admin && <><button onClick={() => void openKnowledge()}>{zh ? '知识版本' : 'Knowledge'}</button><button onClick={() => { setAdminOpen(true); setSettingsOpen(false); setMemoriesOpen(false); setKnowledgeOpen(false); }}>{zh ? '站长控制台' : 'Operator console'}</button></>}<button onClick={() => void exportArchive()}>{zh ? '导出加密档案' : 'Export encrypted archive'}</button><label>{zh ? '恢复档案' : 'Restore archive'}<input type="file" accept="application/json" onChange={event => { const file = event.target.files?.[0]; if (file) void restoreArchive(file); event.currentTarget.value = ''; }}/></label></div>
    </section>}
    {!introOpen && adminOpen && access?.admin && <AgentAdminPanel lang={lang} onClose={() => setAdminOpen(false)}/>}
    {!introOpen && memoriesOpen && <section className="agent-memory-panel">
      <header><div><small>MEMORY VAULT</small><h2>{zh ? '珍奇知道的我' : 'What Zhenqi knows'}</h2></div><button onClick={() => setMemoriesOpen(false)}><Icon name="close" size={16}/></button></header>
      <p>{zh ? '只有与你当前问题相关的少量记忆会进入上下文。原话与推断分开标记；你修改后会变成明确事实。' : 'Only a few relevant memories enter each request. Your words and inferences remain visibly separate.'}</p>
      <div className="agent-memory-stats"><span><b>{memoryStats.explicit}</b>{zh ? '明确记忆' : 'Explicit'}</span><span><b>{memoryStats.inferred}</b>{zh ? '可能推断' : 'Inferred'}</span><span><b>{memoryStats.temporary}</b>{zh ? '自动失效' : 'Expiring'}</span></div>
      <nav className="agent-memory-filters" aria-label={zh ? '记忆类别' : 'Memory categories'}>{memoryFilters.map(filter => <button key={filter} className={memoryFilter === filter ? 'active' : ''} onClick={() => setMemoryFilter(filter)}>{memoryLabel(filter, zh)}<small>{filter === 'all' ? memories.length : memories.filter(memory => memory.category === filter).length}</small></button>)}</nav>
      <div className="agent-memory-list">{visibleMemories.length ? visibleMemories.map(memory => <article key={memory.id}>
        <span className={memory.inferred ? 'inferred' : 'explicit'}>{memory.inferred ? (zh ? '可能' : 'Maybe') : (zh ? '原话' : 'Said')}</span>
        <div><small>{memoryLabel(memory.category, zh)} · {memoryExpiry(memory.expiresAt, zh)}</small><p>{memory.content}</p></div>
        <div><button onClick={() => void editMemory(memory)}>{zh ? '编辑' : 'Edit'}</button><button onClick={() => void removeMemory(memory)}>{zh ? '删除' : 'Delete'}</button></div>
      </article>) : <div className="agent-memory-empty">{memories.length ? (zh ? '这个类别还没有记忆。' : 'No memories in this category.') : (zh ? '珍奇还没有保存长期记忆。' : 'No long-term memories yet.')}</div>}</div>
      <button className="danger-link" disabled={!memories.length} onClick={async () => { if (!window.confirm('清空珍奇的全部长期记忆？此操作无法撤销。')) return; await api('/api/agent/memories', json('DELETE')); setMemories([]); }}>{zh ? '清空全部长期记忆' : 'Clear all memories'}</button>
    </section>}
    {!introOpen && knowledgeOpen && <section className="agent-knowledge-panel">
      <header><div><small>KNOWLEDGE LEDGER</small><h2>{zh ? '珍奇的知识版本' : 'Knowledge versions'}</h2></div><button onClick={() => setKnowledgeOpen(false)}><Icon name="close" size={16}/></button></header>
      <p>{zh ? '版本切换只影响珍奇的公共音乐知识，不会修改播放列表、收藏或私人记忆。' : 'Version changes affect only public music knowledge.'}</p>
      <form onSubmit={event => { event.preventDefault(); void loadKnowledge(knowledgeQuery); }}><input value={knowledgeQuery} onChange={event => setKnowledgeQuery(event.target.value)} placeholder={zh ? '检索歌曲、歌手、情绪或场景' : 'Search title, artist, mood or scene'}/><button disabled={knowledgeBusy}>{zh ? '检索' : 'Search'}</button></form>
      <div className="agent-knowledge-scroll">
        <section className="agent-trend-status">
          <header><div><h3>{zh ? '每周趋势流水线' : 'Weekly trend pipeline'}</h3><p>{zh ? '固定夹具只验证清洗、查重、衍生标记与签名，不会写入正式知识。' : 'The fixture validates normalization and signing without touching active knowledge.'}</p></div><button disabled={knowledgeBusy} onClick={() => void rehearseTrendPipeline()}>{zh ? '运行演练' : 'Rehearse'}</button></header>
          <div className="agent-trend-flags"><span className={trendStatus?.configuration.douyin ? 'ready' : ''}>{zh ? '抖音权限' : 'Douyin'} · {trendStatus?.configuration.douyin ? (zh ? '已配置' : 'Ready') : (zh ? '待审核' : 'Pending')}</span><span className={trendStatus?.configuration.publish ? 'ready' : ''}>{zh ? '发布签名' : 'Signing'} · {trendStatus?.configuration.publish ? (zh ? '已配置' : 'Ready') : (zh ? '未配置' : 'Missing')}</span><span className="ready">{zh ? '汽水快照适配 · 已准备' : 'Qishui snapshots · Ready'}</span></div>
          {trendStatus?.runs[0] && <article><strong>{trendStatus.runs[0].mode === 'fixture' ? (zh ? '最近演练' : 'Latest rehearsal') : (zh ? '最近更新' : 'Latest update')}</strong><span className={trendStatus.runs[0].status}>{trendStatus.runs[0].status}</span><p>{trendStatus.runs[0].message}</p><small>{new Date(trendStatus.runs[0].startedAt).toLocaleString(zh ? 'zh-CN' : 'en-US')}</small></article>}
        </section>
        <section className="agent-knowledge-versions"><h3>{zh ? '版本账本' : 'Version ledger'}</h3>{knowledgeVersions.map(version => <article key={version.id} className={version.status === 'active' ? 'active' : ''}>
          <div><span>{version.kind === 'classic' ? (zh ? '经典库' : 'Classic') : (zh ? '趋势库' : 'Trends')}</span><strong>{version.source}</strong><small>{version.itemCount} {zh ? '条' : 'items'} · {version.embeddedCount}/{version.itemCount} {zh ? '向量' : 'vectors'}</small></div>
          <div>{version.status === 'active' ? <b>{zh ? '正在使用' : 'Active'}</b> : <button onClick={() => void activateKnowledge(version)}>{zh ? '切换' : 'Activate'}</button>}<button disabled={knowledgeBusy || !embeddingConfigured || version.embeddingRemaining === 0} title={!embeddingConfigured ? (zh ? '未配置百炼向量服务，本地全文检索仍可用' : 'Embedding provider is not configured') : ''} onClick={() => void fillKnowledgeEmbeddings(version)}>{version.embeddingRemaining ? (zh ? '补向量' : 'Embed') : (zh ? '已完成' : 'Ready')}</button></div>
        </article>)}</section>
        <section className="agent-knowledge-results"><h3>{knowledgeQuery.trim() ? (zh ? `“${knowledgeQuery.trim()}”的检索结果` : `Results for “${knowledgeQuery.trim()}”`) : (zh ? '输入关键词检查知识召回' : 'Enter a query to inspect retrieval')}</h3>{knowledgeSample.map(item => <article key={item.id}><strong>{item.title}</strong><small>{item.artist || (zh ? '未知歌手' : 'Unknown artist')}</small><p>{item.content}</p><span>{item.sourceUrl ? (zh ? '外部来源可追溯' : 'External source') : (zh ? '内置策展知识' : 'Bundled editorial')}</span></article>)}</section>
      </div>
    </section>}
    {!introOpen && access && !access.entitled && <section className="agent-access"><span>INVITE ONLY</span><h2>{zh ? '珍奇还在小范围试住。' : 'Zhenqi is in a small preview.'}</h2><p>{access.reason}</p><div><input value={inviteCode} onChange={event => setInviteCode(event.target.value)} placeholder={zh ? '输入邀请码' : 'Invite code'}/><button className="btn primary" onClick={() => void redeem()}>{zh ? '唤醒' : 'Redeem'}</button></div></section>}
    {!introOpen && access?.entitled && !access.configured && <section className="agent-access"><span>SAFE OFFLINE</span><h2>{access.reason}</h2><p>{zh ? '音乐小屋其他功能不受影响。' : 'All music features remain available.'}</p></section>}
    {!introOpen && access?.entitled && access.configured && <>
      <div className="agent-messages" ref={scroller} aria-live="polite">
        {!messages.length && <div className="agent-empty"><h2>{zh ? `晚上好，我是${settings?.assistantName || '珍奇'}。` : `Hi, I’m ${settings?.assistantName || 'Zhenqi'}.`}</h2><p>{zh ? '说说你此刻想听什么，或者直接让我暂停、切歌、找一首歌。' : 'Tell me what fits this moment, or ask me to control playback.'}</p><div>{['来点适合夜晚的歌', '换一首', '检查最近为什么播放失败'].map(value => <button key={value} onClick={() => void send(undefined, value)}>{value}</button>)}</div></div>}
        {messages.map(message => { const references = messageCitations(message); return <article key={message.id} className={`agent-message ${message.role}`}><small>{message.role === 'user' ? (zh ? '你' : 'YOU') : (settings?.assistantName || '珍奇')}</small><p>{message.content || (streaming ? '▋' : '')}</p>{!!references.length && <section className="agent-citations"><small>{references.some(item => item.kind === 'web') ? (zh ? '本条回答的资料' : 'Sources for this reply') : (zh ? '本条使用的策展知识' : 'Curated knowledge used')}</small><div>{references.map((citation, index) => citation.url ? <a key={`${citation.kind}-${citation.url}`} href={citation.url} target="_blank" rel="noreferrer"><b>{index + 1}</b><span>{citation.title}<small>{citation.detail}</small></span></a> : <div className="agent-citation-local" key={`${citation.kind}-${citation.title}`}><b>{index + 1}</b><span>{citation.title}<small>{citation.detail}</small></span></div>)}</div></section>}{message.role === 'assistant' && message.content && <button className={`agent-read ${speakingMessageId === message.id ? 'active' : ''}`} onClick={() => void readText(message.content, message.id)}><Icon name="speaker" size={13}/>{speakingMessageId === message.id ? (zh ? '停止' : 'Stop') : (zh ? '朗读' : 'Read')}</button>}</article>; })}
        {actionReceipts.map(receipt => <section className={`agent-action-receipt ${receipt.status}`} key={receipt.actionId} role="status">
          <span aria-hidden="true"/><div><small>{receipt.status === 'undone' ? (zh ? '已恢复原状态' : 'State restored') : receipt.status === 'failed' ? (zh ? '撤销未完成' : 'Undo failed') : (zh ? '操作已完成' : 'Action complete')}</small><strong>{receipt.message}</strong></div>
          {receipt.undoAction && receipt.status !== 'undone' && <button disabled={receipt.status === 'undoing'} onClick={() => void undoReceipt(receipt)}><Icon name="return" size={13}/>{receipt.status === 'undoing' ? (zh ? '恢复中' : 'Restoring') : receipt.status === 'failed' ? (zh ? '重试' : 'Retry') : (zh ? '撤销' : 'Undo')}</button>}
        </section>)}
        {reasonCards.map(card => <section className="agent-reason-card" key={card.id}><small>SCENE QUEUE</small><h3>{card.title}</h3><p>{card.body}</p><div>{card.tracks.map((track, index) => <button key={track.id} onClick={() => void onAction({ type: 'play_track', track, queue: card.tracks, reason: card.body })}><b>{String(index + 1).padStart(2, '0')}</b><span><strong>{track.title}</strong><small>{track.artist}</small></span><Icon name="play" size={14}/></button>)}</div></section>)}
        {pendingActions.map(item => <section className="agent-confirm-card" key={item.actionId}><small>CONFIRMATION</small><h3>{item.summary}</h3><p>{zh ? '这是会修改数据的操作，珍奇不会替你决定。' : 'This changes data and requires your decision.'}</p>{item.status ? <strong>{item.status}</strong> : <div><button className="btn ghost" onClick={() => void resolvePending(item, false)}>{zh ? '取消' : 'Cancel'}</button><button className="btn primary" onClick={() => void resolvePending(item, true)}>{zh ? '确认' : 'Confirm'}</button></div>}</section>)}
      </div>
      <form className="agent-composer" onSubmit={event => void send(event)}>
        {error && <div className="agent-error"><Icon name="warning" size={14}/>{error}</div>}
        <textarea rows={2} value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder={zh ? '告诉珍奇你此刻需要什么…' : 'Tell Zhenqi what you need…'}/>
        <div><button type="button" className={webSearch ? 'active' : ''} title={zh ? '仅下一条消息联网' : 'Web for next message only'} onClick={() => setWebSearch(value => !value)}><Icon name="globe" size={16}/><span>{webSearch ? (zh ? '本条联网' : 'Web on') : (zh ? '联网' : 'Web')}</span></button><button type="button" className={`agent-mic ${recording ? 'recording' : ''}`} disabled={transcribing} title={recording ? (zh ? '结束录音' : 'Stop recording') : (zh ? '语音输入，最长 60 秒' : 'Voice input, up to 60s')} onClick={() => void toggleRecording()}><Icon name="microphone" size={15}/></button><small>{recording ? (zh ? '正在录音…' : 'Recording…') : transcribing ? (zh ? '正在转写…' : 'Transcribing…') : streaming ? (zh ? '珍奇正在组织回应…' : 'Zhenqi is responding…') : conversation?.kind === 'temporary' ? '24H TEMP' : 'ENCRYPTED'}</small><button className="agent-send" disabled={!input.trim()} aria-label={zh ? '发送' : 'Send'}><Icon name="send" size={17}/></button></div>
      </form>
    </>}
    {!introOpen && error && (!access?.entitled || !access?.configured) && <div className="agent-error standalone"><Icon name="warning" size={14}/>{error}</div>}
  </aside>;
}
