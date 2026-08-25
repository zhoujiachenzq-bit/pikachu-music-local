export const AGENT_VOICE_PROFILE_IDS = [
  'kokoro-zf-001',
  'azure-xiaoxiao',
  'azure-xiaoke',
  'minimax-soothing-host',
  'minimax-warm-bestie',
  'minimax-gentleman',
  'minimax-gentle-youth',
  'minimax-crisp-podcaster',
  'minimax-radio-reporter',
  'minimax-office-man',
  'bailian-cherry',
  'bailian-serena',
  'bailian-ethan',
  'bailian-chelsie'
] as const;

export type AgentVoiceProfileId = typeof AGENT_VOICE_PROFILE_IDS[number];
export type AgentVoiceProviderId = 'kokoro' | 'azure' | 'minimax' | 'bailian';
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
    id: 'kokoro-zf-001', provider: 'kokoro', group: 'selected', recommended: true,
    labelZh: 'Kokoro · 本地中文女声', labelEn: 'Kokoro · Local Chinese female',
    descriptionZh: '免费在本机生成，清晰自然；无需账户，语音内容不会发送给音色供应商。',
    descriptionEn: 'Generated locally for free with no voice-provider account or text upload.'
  },
  {
    id: 'azure-xiaoxiao', provider: 'azure', group: 'selected',
    labelZh: '晓晓 · 标准中文女声', labelEn: 'Xiaoxiao · Standard Chinese',
    descriptionZh: '自然、清晰、温暖，适合日常聊天与音乐推荐。',
    descriptionEn: 'Natural, clear and warm for everyday conversation and recommendations.'
  },
  {
    id: 'azure-xiaoke', provider: 'azure', group: 'selected',
    labelZh: '晓可 Dragon · 灵动女声', labelEn: 'Xiaoke Dragon · Expressive female',
    descriptionZh: '灵动、有表情，适合作为晓晓之外更鲜活的中文选择。',
    descriptionEn: 'Expressive and lively, offering a more animated Chinese alternative to Xiaoxiao.'
  },
  {
    id: 'minimax-soothing-host', provider: 'minimax', group: 'selected',
    labelZh: 'Soothing Host · 舒缓女声', labelEn: 'Soothing Host · Calm female',
    descriptionZh: '松弛、安定，适合深夜陪伴与情绪安抚。',
    descriptionEn: 'Relaxed and reassuring for late-night listening and comfort.'
  },
  {
    id: 'minimax-warm-bestie', provider: 'minimax', group: 'selected',
    labelZh: 'Warm Bestie · 亲近女声', labelEn: 'Warm Bestie · Friendly female',
    descriptionZh: '亲近、温暖，适合轻松聊天与日常陪伴。', descriptionEn: 'Friendly and warm for relaxed conversation and everyday company.'
  },
  {
    id: 'minimax-gentleman', provider: 'minimax', group: 'selected',
    labelZh: 'Gentleman · 成熟男声', labelEn: 'Gentleman · Mature male',
    descriptionZh: '沉稳、有礼，适合克制表达与音乐故事。', descriptionEn: 'Composed and courteous for restrained delivery and music stories.'
  },
  {
    id: 'minimax-gentle-youth', provider: 'minimax', group: 'selected',
    labelZh: 'Gentle Youth · 温柔青年', labelEn: 'Gentle Youth · Gentle male',
    descriptionZh: '年轻、柔和，适合温和推荐与轻声陪伴。', descriptionEn: 'Youthful and gentle for soft recommendations and companionship.'
  },
  {
    id: 'minimax-crisp-podcaster', provider: 'minimax', group: 'selected',
    labelZh: 'Crisp Podcaster · 清晰播客声', labelEn: 'Crisp Podcaster · Clear host',
    descriptionZh: '清晰、利落，适合知识解释和较长内容。', descriptionEn: 'Clear and articulate for explanations and longer-form speech.'
  },
  {
    id: 'minimax-radio-reporter', provider: 'minimax', group: 'selected',
    labelZh: 'Radio Reporter · 电台播报声', labelEn: 'Radio Reporter · Broadcast host',
    descriptionZh: '具有广播质感，适合资讯、榜单和推荐摘要。', descriptionEn: 'Broadcast-like delivery for updates, charts and recommendation summaries.'
  },
  {
    id: 'minimax-office-man', provider: 'minimax', group: 'legacy',
    labelZh: 'Office Man · 旧候选兼容', labelEn: 'Office Man · Previous candidate',
    descriptionZh: '保留已经保存过的候选设置，不再列入珍奇精选。',
    descriptionEn: 'Preserves previously saved preferences without keeping it in the curated set.'
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
  Cherry: 'kokoro-zf-001', Serena: 'bailian-serena', Ethan: 'bailian-ethan', Chelsie: 'bailian-chelsie'
};

export function normalizeAgentVoiceId(value: unknown): AgentVoiceProfileId {
  const raw = String(value || '').trim();
  if ((AGENT_VOICE_PROFILE_IDS as readonly string[]).includes(raw)) return raw as AgentVoiceProfileId;
  return LEGACY_VOICE_IDS[raw] || 'kokoro-zf-001';
}

export function agentVoiceProfile(id: unknown): AgentVoiceProfile {
  const normalized = normalizeAgentVoiceId(id);
  return AGENT_VOICE_PROFILES.find(profile => profile.id === normalized) || AGENT_VOICE_PROFILES[0];
}
