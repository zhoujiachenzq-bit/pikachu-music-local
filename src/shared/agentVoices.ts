export const KOKORO_FEMALE_VOICE_IDS = [
  'zf_001', 'zf_002', 'zf_003', 'zf_004', 'zf_005', 'zf_006', 'zf_007', 'zf_008', 'zf_017', 'zf_018', 'zf_019',
  'zf_021', 'zf_022', 'zf_023', 'zf_024', 'zf_026', 'zf_027', 'zf_028', 'zf_032', 'zf_036', 'zf_038', 'zf_039',
  'zf_040', 'zf_042', 'zf_043', 'zf_044', 'zf_046', 'zf_047', 'zf_048', 'zf_049', 'zf_051', 'zf_059', 'zf_060',
  'zf_067', 'zf_070', 'zf_071', 'zf_072', 'zf_073', 'zf_074', 'zf_075', 'zf_076', 'zf_077', 'zf_078', 'zf_079',
  'zf_083', 'zf_084', 'zf_085', 'zf_086', 'zf_087', 'zf_088', 'zf_090', 'zf_092', 'zf_093', 'zf_094', 'zf_099'
] as const;

export const KOKORO_MALE_VOICE_IDS = [
  'zm_009', 'zm_010', 'zm_011', 'zm_012', 'zm_013', 'zm_014', 'zm_015', 'zm_016', 'zm_020', 'zm_025', 'zm_029',
  'zm_030', 'zm_031', 'zm_033', 'zm_034', 'zm_035', 'zm_037', 'zm_041', 'zm_045', 'zm_050', 'zm_052', 'zm_053',
  'zm_054', 'zm_055', 'zm_056', 'zm_057', 'zm_058', 'zm_061', 'zm_062', 'zm_063', 'zm_064', 'zm_065', 'zm_066',
  'zm_068', 'zm_069', 'zm_080', 'zm_081', 'zm_082', 'zm_089', 'zm_091', 'zm_095', 'zm_096', 'zm_097', 'zm_098', 'zm_100'
] as const;

export const KOKORO_VOICE_IDS = [...KOKORO_FEMALE_VOICE_IDS, ...KOKORO_MALE_VOICE_IDS] as const;
export type KokoroVoiceId = typeof KOKORO_VOICE_IDS[number];
type Dashed<T extends string> = T extends `${infer Prefix}_${infer Number}` ? `${Prefix}-${Number}` : T;
export type KokoroVoiceProfileId = `kokoro-${Dashed<KokoroVoiceId>}`;

const ONLINE_VOICE_PROFILE_IDS = [
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

const kokoroProfileId = (voice: KokoroVoiceId) => `kokoro-${voice.replace('_', '-')}` as KokoroVoiceProfileId;
export const KOKORO_VOICE_PROFILE_IDS = KOKORO_VOICE_IDS.map(kokoroProfileId);
export type AgentVoiceProfileId = KokoroVoiceProfileId | typeof ONLINE_VOICE_PROFILE_IDS[number];
export const AGENT_VOICE_PROFILE_IDS = [...KOKORO_VOICE_PROFILE_IDS, ...ONLINE_VOICE_PROFILE_IDS] as unknown as readonly [AgentVoiceProfileId, ...AgentVoiceProfileId[]];
export type AgentVoiceProviderId = 'kokoro' | 'azure' | 'minimax' | 'bailian';
export type AgentVoiceGroup = 'kokoro-female' | 'kokoro-male' | 'selected' | 'legacy';

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

const KOKORO_PROFILE_TO_VOICE = new Map<AgentVoiceProfileId, KokoroVoiceId>(KOKORO_VOICE_IDS.map(voice => [kokoroProfileId(voice), voice]));
const KOKORO_VOICE_PROFILES: readonly AgentVoiceProfile[] = KOKORO_VOICE_IDS.map(voice => {
  const female = voice.startsWith('zf_');
  const sequence = (female ? KOKORO_FEMALE_VOICE_IDS : KOKORO_MALE_VOICE_IDS).indexOf(voice as never) + 1;
  const currentDefault = voice === 'zf_001';
  return {
    id: kokoroProfileId(voice), provider: 'kokoro', group: female ? 'kokoro-female' : 'kokoro-male', recommended: currentDefault,
    labelZh: `${female ? '女声' : '男声'} ${String(sequence).padStart(2, '0')} · ${voice}`,
    labelEn: `${female ? 'Female' : 'Male'} ${String(sequence).padStart(2, '0')} · ${voice}`,
    descriptionZh: currentDefault ? '当前默认音色；免费在本机生成，语音内容不会发送给音色供应商。' : `Kokoro 中文${female ? '女' : '男'}声候选 ${voice}；编号不代表音色排名，请使用相同文案试听。`,
    descriptionEn: currentDefault ? 'Current default, generated locally without uploading text to a voice provider.' : `Local Kokoro Chinese ${female ? 'female' : 'male'} candidate ${voice}; use the shared samples for a fair comparison.`
  };
});

export const AGENT_VOICE_PROFILES: readonly AgentVoiceProfile[] = [
  ...KOKORO_VOICE_PROFILES,
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

export function kokoroVoiceIdForProfile(id: unknown): KokoroVoiceId | null {
  return KOKORO_PROFILE_TO_VOICE.get(String(id) as AgentVoiceProfileId) || null;
}
