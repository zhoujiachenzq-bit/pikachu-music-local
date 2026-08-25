export const AGENT_VOICE_PROFILE_IDS = [
  'azure-xiaoxiao',
  'minimax-soothing-host',
  'minimax-office-man',
  'bailian-cherry',
  'bailian-serena',
  'bailian-ethan',
  'bailian-chelsie'
] as const;

export type AgentVoiceProfileId = typeof AGENT_VOICE_PROFILE_IDS[number];
export type AgentVoiceProviderId = 'azure' | 'minimax' | 'bailian';
export type AgentVoiceGroup = 'selected' | 'legacy';

export interface AgentVoiceProfile {
  id: AgentVoiceProfileId;
  provider: AgentVoiceProviderId;
  group: AgentVoiceGroup;
  labelZh: string;
  labelEn: string;
  descriptionZh: string;
  descriptionEn: string;
  recommended?: boolean;
}

export interface AgentVoiceOption extends AgentVoiceProfile {
  available: boolean;
}

export const AGENT_VOICE_PROFILES: readonly AgentVoiceProfile[] = [
  {
    id: 'azure-xiaoxiao', provider: 'azure', group: 'selected', recommended: true,
    labelZh: '晓晓 · 标准中文女声', labelEn: 'Xiaoxiao · Standard Chinese',
    descriptionZh: '自然、清晰、温暖，适合日常聊天与音乐推荐。',
    descriptionEn: 'Natural, clear and warm for everyday conversation and recommendations.'
  },
  {
    id: 'minimax-soothing-host', provider: 'minimax', group: 'selected',
    labelZh: 'Soothing Host · 舒缓女声', labelEn: 'Soothing Host · Calm female',
    descriptionZh: '松弛、安定，适合深夜陪伴与情绪安抚。',
    descriptionEn: 'Relaxed and reassuring for late-night listening and comfort.'
  },
  {
    id: 'minimax-office-man', provider: 'minimax', group: 'selected',
    labelZh: 'Office Man · 自然男声', labelEn: 'Office Man · Natural male',
    descriptionZh: '稳重但不生硬，适合信息说明与克制的音乐介绍。',
    descriptionEn: 'Grounded without sounding stiff, suited to concise explanations.'
  },
  {
    id: 'bailian-cherry', provider: 'bailian', group: 'legacy',
    labelZh: 'Cherry · 兼容女声', labelEn: 'Cherry · Legacy female',
    descriptionZh: '保留已有账户的百炼音色设置。', descriptionEn: 'Keeps existing Bailian voice preferences compatible.'
  },
  {
    id: 'bailian-serena', provider: 'bailian', group: 'legacy',
    labelZh: 'Serena · 兼容女声', labelEn: 'Serena · Legacy female',
    descriptionZh: '保留已有账户的百炼音色设置。', descriptionEn: 'Keeps existing Bailian voice preferences compatible.'
  },
  {
    id: 'bailian-ethan', provider: 'bailian', group: 'legacy',
    labelZh: 'Ethan · 兼容男声', labelEn: 'Ethan · Legacy male',
    descriptionZh: '保留已有账户的百炼音色设置。', descriptionEn: 'Keeps existing Bailian voice preferences compatible.'
  },
  {
    id: 'bailian-chelsie', provider: 'bailian', group: 'legacy',
    labelZh: 'Chelsie · 兼容女声', labelEn: 'Chelsie · Legacy female',
    descriptionZh: '保留已有账户的百炼音色设置。', descriptionEn: 'Keeps existing Bailian voice preferences compatible.'
  }
] as const;

const LEGACY_VOICE_IDS: Record<string, AgentVoiceProfileId> = {
  Cherry: 'azure-xiaoxiao', Serena: 'bailian-serena', Ethan: 'bailian-ethan', Chelsie: 'bailian-chelsie'
};

export function normalizeAgentVoiceId(value: unknown): AgentVoiceProfileId {
  const raw = String(value || '').trim();
  if ((AGENT_VOICE_PROFILE_IDS as readonly string[]).includes(raw)) return raw as AgentVoiceProfileId;
  return LEGACY_VOICE_IDS[raw] || 'azure-xiaoxiao';
}

export function agentVoiceProfile(id: unknown): AgentVoiceProfile {
  const normalized = normalizeAgentVoiceId(id);
  return AGENT_VOICE_PROFILES.find(profile => profile.id === normalized) || AGENT_VOICE_PROFILES[0];
}
