import { describe, expect, it } from 'vitest';
import type { AgentClientContext, Track } from '../shared/types';
import { deriveAgentUndoAction } from './agentActionUndo';

const track: Track = { id: 'qq:1', source: 'qq', sourceTrackId: '1', title: '晴天', artist: '周杰伦', album: '叶惠美', duration: 269_000, coverUrl: null, sourceUrl: null };
const context: AgentClientContext = { currentTrack: track, queue: [track], playing: true, currentTime: 83, volume: .72, playMode: 'shuffle', mobileSection: 'player', toneTheme: 'night' };

describe('Zhenqi reversible client actions', () => {
  it('restores the previous track, queue, position and play state after switching songs', () => {
    expect(deriveAgentUndoAction({ type: 'next' }, context)).toEqual({
      type: 'play_track', track, queue: [track], reason: '恢复珍奇操作前的播放状态', startAtSeconds: 83, resumePlayback: true,
    });
    expect(deriveAgentUndoAction({ type: 'play_track', track: { ...track, id: 'qq:2' } }, { ...context, playing: false })).toMatchObject({ type: 'play_track', track, startAtSeconds: 83, resumePlayback: false });
  });

  it('reverses playback controls and user preferences to their exact prior values', () => {
    expect(deriveAgentUndoAction({ type: 'pause' }, context)).toEqual({ type: 'resume' });
    expect(deriveAgentUndoAction({ type: 'resume' }, { ...context, playing: false })).toEqual({ type: 'pause' });
    expect(deriveAgentUndoAction({ type: 'seek', seconds: 150 }, context)).toEqual({ type: 'seek', seconds: 83 });
    expect(deriveAgentUndoAction({ type: 'set_volume', volume: .2 }, context)).toEqual({ type: 'set_volume', volume: .72 });
    expect(deriveAgentUndoAction({ type: 'set_play_mode', mode: 'loop' }, context)).toEqual({ type: 'set_play_mode', mode: 'shuffle' });
    expect(deriveAgentUndoAction({ type: 'set_theme', theme: 'arcade' }, context)).toEqual({ type: 'set_theme', theme: 'night' });
    expect(deriveAgentUndoAction({ type: 'navigate', section: 'daily' }, context)).toEqual({ type: 'navigate', section: 'player' });
  });

  it('does not offer meaningless or irreversible undo actions', () => {
    expect(deriveAgentUndoAction({ type: 'pause' }, { ...context, playing: false })).toBeUndefined();
    expect(deriveAgentUndoAction({ type: 'set_volume', volume: .72 }, context)).toBeUndefined();
    expect(deriveAgentUndoAction({ type: 'retry_current' }, context)).toBeUndefined();
    expect(deriveAgentUndoAction({ type: 'clear_client_cache' }, context)).toBeUndefined();
    expect(deriveAgentUndoAction({ type: 'next' }, { ...context, currentTrack: null, queue: [] })).toBeUndefined();
  });
});
