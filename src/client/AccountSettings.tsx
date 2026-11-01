import { useState, type FormEvent } from 'react';
import { api, json } from './api';
import type { User } from '../shared/types';
import './accountSettings.css';

export function AccountSettings({ user, lang, onSignedOut, onInstall }: { user: User; lang: 'zh' | 'en'; onSignedOut: () => void; onInstall?: () => void }) {
  const zh = lang === 'zh';
  const [mode, setMode] = useState<'overview' | 'password' | 'delete'>('overview');
  const [currentPassword, setCurrentPassword] = useState(''); const [newPassword, setNewPassword] = useState(''); const [repeatPassword, setRepeatPassword] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const changeMode = (next: typeof mode) => { setMode(next); setCurrentPassword(''); setNewPassword(''); setRepeatPassword(''); setError(''); };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return; setError('');
    if (mode === 'password' && newPassword !== repeatPassword) { setError(zh ? '两次新密码不一致。' : 'New passwords do not match.'); return; }
    setBusy(true);
    try {
      if (mode === 'password') await api('/api/auth/password', json('PATCH', { currentPassword, newPassword }));
      else await api('/api/auth/account', json('DELETE', { password: currentPassword }));
      setCurrentPassword(''); setNewPassword(''); setRepeatPassword(''); onSignedOut();
    } catch (cause) { setError(cause instanceof Error ? cause.message : zh ? '操作失败，请重试。' : 'Please try again.'); }
    finally { setBusy(false); }
  };
  return <div className="account-settings">
    <div className="account-identity"><span className="account-avatar">{user.username.slice(0, 1).toUpperCase()}</span><strong>{user.username}</strong></div>
    {mode === 'overview' ? <div className="account-options">
      {onInstall && <button className="btn primary" onClick={onInstall}>{zh ? '安装应用' : 'Install app'}</button>}
      <button className="btn ghost" onClick={() => changeMode('password')}>{zh ? '修改密码' : 'Change password'}</button>
      <button className="btn ghost" disabled={busy} onClick={async () => {
        setBusy(true); setError('');
        try { await api('/api/auth/logout', json('POST')); onSignedOut(); }
        catch (cause) { setError(cause instanceof Error ? cause.message : zh ? '退出失败。' : 'Sign out failed.'); }
        finally { setBusy(false); }
      }}>{zh ? '退出登录' : 'Sign out'}</button>
      <button className="account-delete" onClick={() => changeMode('delete')}>{zh ? '删除账户' : 'Delete account'}</button>
    </div> : <form className="account-form" onSubmit={event => void submit(event)}>
      <h3>{mode === 'password' ? (zh ? '修改密码' : 'Change password') : (zh ? '删除账户' : 'Delete account')}</h3>
      {mode === 'delete' && <p>{zh ? '账户及其收藏、歌单等数据将被删除，无法撤销。' : 'Your account and its data will be permanently deleted.'}</p>}
      <label>{zh ? '当前密码' : 'Current password'}<input autoFocus type="password" autoComplete="current-password" required maxLength={72} value={currentPassword} disabled={busy} onChange={event => setCurrentPassword(event.target.value)}/></label>
      {mode === 'password' && <>
        <label>{zh ? '新密码（8–72 位）' : 'New password (8–72 characters)'}<input type="password" autoComplete="new-password" required minLength={8} maxLength={72} value={newPassword} disabled={busy} onChange={event => setNewPassword(event.target.value)}/></label>
        <label>{zh ? '确认新密码' : 'Confirm new password'}<input type="password" autoComplete="new-password" required minLength={8} maxLength={72} value={repeatPassword} disabled={busy} onChange={event => setRepeatPassword(event.target.value)}/></label>
        <p>{zh ? '修改成功后需要重新登录。' : 'Sign in again after changing your password.'}</p>
      </>}
      <div className="account-form-actions"><button type="button" className="btn ghost" disabled={busy} onClick={() => changeMode('overview')}>{zh ? '取消' : 'Cancel'}</button><button className={`btn ${mode === 'delete' ? 'account-confirm-delete' : 'primary'}`} disabled={busy}>{busy ? (zh ? '处理中…' : 'Working…') : mode === 'delete' ? (zh ? '确认删除' : 'Delete account') : (zh ? '保存密码' : 'Save password')}</button></div>
    </form>}
    {error && <p className="account-error" role="alert">{error}</p>}
  </div>;
}
