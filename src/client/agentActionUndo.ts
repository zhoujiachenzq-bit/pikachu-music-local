import type { AgentClientAction, AgentClientContext } from '../shared/types';

function restorePlayback(context: AgentClientContext): AgentClientAction | undefined {
  if (!context.currentTrack) return undefined;
  return {
    type: 'play_track',
    track: context.currentTrack,
    queue: context.queue.length ? context.queue : [context.currentTrack],
    reason: '恢复珍奇操作前的播放状态',
    startAtSeconds: Math.max(0, context.currentTime),
    resumePlayback: context.playing,
  };
}

export function deriveAgentUndoAction(action: AgentClientAction, context: AgentClientContext): AgentClientAction | undefined {
  if (action.type === 'play_track' || action.type === 'next' || action.type === 'previous') return restorePlayback(context);
  if (action.type === 'pause') return context.playing ? { type: 'resume' } : undefined;
  if (action.type === 'resume') return context.playing ? undefined : { type: 'pause' };
  if (action.type === 'seek') return { type: 'seek', seconds: Math.max(0, context.currentTime) };
  if (action.type === 'set_volume') return Math.abs(action.volume - context.volume) > .001 ? { type: 'set_volume', volume: context.volume } : undefined;
  if (action.type === 'set_play_mode') return action.mode !== context.playMode ? { type: 'set_play_mode', mode: context.playMode } : undefined;
  if (action.type === 'set_theme') return context.toneTheme && action.theme !== context.toneTheme ? { type: 'set_theme', theme: context.toneTheme } : undefined;
  if (action.type === 'navigate') return context.mobileSection && action.section !== context.mobileSection ? { type: 'navigate', section: context.mobileSection } : undefined;
  return undefined;
}
