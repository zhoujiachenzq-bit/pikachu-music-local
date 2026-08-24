import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, json } from './api';
import { Icon } from './ui';
import type { AgentBudgetState } from '../shared/agentAdmin';

interface ProviderCapabilityMap {
  text: boolean;
  streaming: boolean;
  tools: boolean;
  structuredOutput: boolean;
  reasoning: boolean;
  imageInput: boolean;
  audioInput: boolean;
}

interface ProviderStatus {
  id: 'deepseek' | 'bailian' | 'custom';
  label: string;
  configured: boolean;
  selected: boolean;
  models: { flash: string; plus: string };
  capabilities: ProviderCapabilityMap;
}

interface ProviderResponse { selectionMode: 'auto' | ProviderStatus['id']; providers: ProviderStatus[]; }
interface UsageRow { usage_date: string; provider: string; model: string; input_tokens: number; output_tokens: number; search_calls: number; asr_seconds: number; tts_characters: number; estimated_cost_cny: number; }
interface UsageResponse { monthlyCostCny: number; budgetCny: number; ratio: number; state: AgentBudgetState; periodDays: number; rows: UsageRow[]; }
interface AgentInvite { id: string; code?: string; maxUses: number; useCount: number; expiresAt: string; disabled: boolean; note: string; createdAt: string; }

const formatMoney = (value: number) => `¥${Number(value || 0).toFixed(value >= 10 ? 2 : 4)}`;
const formatDate = (value: string, zh: boolean) => new Date(value).toLocaleDateString(zh ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function AgentAdminPanel({ lang, onClose }: { lang: 'zh' | 'en'; onClose: () => void }) {
  const zh = lang === 'zh';
  const [providers, setProviders] = useState<ProviderResponse | null>(null);
  const [usage, setUsage] = useState<UsageResponse | null>(null);
  const [invites, setInvites] = useState<AgentInvite[]>([]);
  const [createdCode, setCreatedCode] = useState('');
  const [maxUses, setMaxUses] = useState(1);
  const [expiresInDays, setExpiresInDays] = useState(30);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setBusy(true); setError('');
    try {
      const [providerData, usageData, inviteData] = await Promise.all([
        api<ProviderResponse>('/api/admin/agent/providers'),
        api<UsageResponse>('/api/admin/agent/usage?days=31'),
        api<{ invites: AgentInvite[] }>('/api/admin/agent/invites')
      ]);
      setProviders(providerData); setUsage(usageData); setInvites(inviteData.invites);
    } catch (cause) { setError(cause instanceof Error ? cause.message : (zh ? '站长数据加载失败。' : 'Admin data failed to load.')); }
    finally { setBusy(false); }
  }, [zh]);

  useEffect(() => { void load(); }, [load]);

  const totals = useMemo(() => usage?.rows.reduce((result, row) => ({
    input: result.input + Number(row.input_tokens || 0), output: result.output + Number(row.output_tokens || 0),
    searches: result.searches + Number(row.search_calls || 0), speech: result.speech + Number(row.asr_seconds || 0),
    tts: result.tts + Number(row.tts_characters || 0)
  }), { input: 0, output: 0, searches: 0, speech: 0, tts: 0 }) || { input: 0, output: 0, searches: 0, speech: 0, tts: 0 }, [usage]);

  const createInvite = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError(''); setCreatedCode('');
    try {
      const result = await api<{ invite: AgentInvite }>('/api/admin/agent/invites', json('POST', { maxUses, expiresInDays, note: note.trim() }));
      setInvites(value => [{ ...result.invite, code: undefined }, ...value]); setCreatedCode(result.invite.code || ''); setNote('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : (zh ? '邀请码创建失败。' : 'Could not create invite.')); }
    finally { setBusy(false); }
  };

  const toggleInvite = async (invite: AgentInvite) => {
    setBusy(true); setError('');
    try {
      await api(`/api/admin/agent/invites/${invite.id}`, json('PATCH', { disabled: !invite.disabled }));
      setInvites(value => value.map(item => item.id === invite.id ? { ...item, disabled: !item.disabled } : item));
    } catch (cause) { setError(cause instanceof Error ? cause.message : (zh ? '邀请码状态更新失败。' : 'Could not update invite.')); }
    finally { setBusy(false); }
  };

  const copyCode = async () => {
    try { await navigator.clipboard.writeText(createdCode); }
    catch { setError(zh ? '浏览器未允许复制，请手动选择邀请码。' : 'Clipboard access was blocked; copy the code manually.'); }
  };

  const budgetCopy = usage?.state === 'paused'
    ? (zh ? '已暂停新的模型与语音调用' : 'New AI and speech calls are paused')
    : usage?.state === 'flash_only'
      ? (zh ? '已进入节省模式，只使用 Flash' : 'Economy mode: Flash only')
      : (zh ? '预算状态正常' : 'Budget is healthy');

  return <section className="agent-admin-panel">
    <header><div><small>OPERATOR CONSOLE</small><h2>{zh ? '珍奇站长台' : 'Zhenqi operator console'}</h2></div><button aria-label={zh ? '关闭站长台' : 'Close admin console'} onClick={onClose}><Icon name="close" size={16}/></button></header>
    <p>{zh ? '这里只显示脱敏配置与聚合用量，不读取 API Key、对话正文或其他用户的私密记忆。' : 'Only redacted configuration and aggregate usage appear here—never API keys, message text, or private memories.'}</p>
    {error && <div className="agent-error"><Icon name="warning" size={14}/>{error}<button onClick={() => void load()}>{zh ? '重试' : 'Retry'}</button></div>}
    <div className="agent-admin-scroll" aria-busy={busy}>
      <section className="agent-admin-budget">
        <div><small>{zh ? '本月智能体预算' : 'Monthly agent budget'}</small><strong>{usage ? formatMoney(usage.monthlyCostCny) : '—'} <i>/ {usage ? formatMoney(usage.budgetCny) : '—'}</i></strong><span className={usage?.state || ''}>{budgetCopy}</span></div>
        <div className="agent-budget-meter"><span style={{ width: `${Math.min(100, Math.max(0, (usage?.ratio || 0) * 100))}%` }}/></div>
        <ul><li><b>{(totals.input + totals.output).toLocaleString()}</b>{zh ? '模型 Token' : 'Model tokens'}</li><li><b>{totals.searches}</b>{zh ? '联网次数' : 'Web calls'}</li><li><b>{Math.round(totals.speech)}s</b>{zh ? '语音转写' : 'ASR time'}</li><li><b>{totals.tts.toLocaleString()}</b>{zh ? '合成字符' : 'TTS chars'}</li></ul>
      </section>

      <section className="agent-admin-providers">
        <header><div><small>{zh ? '模型路由' : 'Model routing'}</small><h3>{zh ? `选择方式：${providers?.selectionMode || '—'}` : `Selection: ${providers?.selectionMode || '—'}`}</h3></div><span>{providers?.providers.filter(item => item.configured).length || 0} / {providers?.providers.length || 0} READY</span></header>
        <div>{providers?.providers.map(provider => <article key={provider.id} className={provider.selected ? 'selected' : ''}>
          <div><span className={provider.configured ? 'ready' : ''}>{provider.configured ? (zh ? '已配置' : 'Ready') : (zh ? '未配置' : 'Missing')}</span>{provider.selected && <b>{zh ? '当前使用' : 'Selected'}</b>}</div>
          <h4>{provider.label}</h4><p>Flash · {provider.models.flash}</p><p>Plus · {provider.models.plus}</p>
          <footer>{provider.capabilities.tools && <span>TOOLS</span>}{provider.capabilities.reasoning && <span>REASONING</span>}{provider.capabilities.imageInput && <span>VISION</span>}{!provider.capabilities.imageInput && <span>TEXT ONLY</span>}</footer>
        </article>)}</div>
      </section>

      <section className="agent-admin-invites">
        <header><div><small>{zh ? '珍奇访问权' : 'Agent access'}</small><h3>{zh ? '邀请码' : 'Invitations'}</h3></div><span>{invites.filter(item => !item.disabled && Date.parse(item.expiresAt) > Date.now() && item.useCount < item.maxUses).length} ACTIVE</span></header>
        <form onSubmit={event => void createInvite(event)}>
          <label>{zh ? '可用次数' : 'Uses'}<input type="number" min={1} max={100} value={maxUses} onChange={event => setMaxUses(Number(event.target.value))}/></label>
          <label>{zh ? '有效天数' : 'Days'}<input type="number" min={1} max={365} value={expiresInDays} onChange={event => setExpiresInDays(Number(event.target.value))}/></label>
          <label className="wide">{zh ? '备注' : 'Note'}<input maxLength={200} value={note} onChange={event => setNote(event.target.value)} placeholder={zh ? '例如：朋友测试名额' : 'e.g. friend preview'}/></label>
          <button disabled={busy}>{zh ? '生成邀请码' : 'Create invite'}</button>
        </form>
        {createdCode && <div className="agent-new-invite"><small>{zh ? '只在本次显示，请现在保存' : 'Shown once—save it now'}</small><strong>{createdCode}</strong><button onClick={() => void copyCode()}>{zh ? '复制' : 'Copy'}</button></div>}
        <div className="agent-invite-list">{invites.length ? invites.map(invite => {
          const expired = Date.parse(invite.expiresAt) <= Date.now(); const exhausted = invite.useCount >= invite.maxUses;
          return <article key={invite.id} className={invite.disabled || expired || exhausted ? 'inactive' : ''}><div><strong>{invite.note || (zh ? '未填写备注' : 'No note')}</strong><small>{invite.useCount}/{invite.maxUses} · {formatDate(invite.expiresAt, zh)}</small></div><span>{invite.disabled ? (zh ? '已停用' : 'Disabled') : expired ? (zh ? '已过期' : 'Expired') : exhausted ? (zh ? '已用完' : 'Used') : (zh ? '可使用' : 'Active')}</span><button disabled={busy || expired || exhausted} onClick={() => void toggleInvite(invite)}>{invite.disabled ? (zh ? '重新启用' : 'Enable') : (zh ? '停用' : 'Disable')}</button></article>;
        }) : <p>{zh ? '还没有生成邀请码。' : 'No invitations yet.'}</p>}</div>
      </section>
    </div>
  </section>;
}
