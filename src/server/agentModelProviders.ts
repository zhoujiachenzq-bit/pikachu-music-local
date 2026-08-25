import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { streamText, type ModelMessage, type ToolSet } from 'ai';
import { loadAgentProviderConfig } from './agentProviders.js';

export type AgentModelTier = 'flash' | 'plus' | 'local';
export type RemoteAgentModelTier = Exclude<AgentModelTier, 'local'>;
export type AgentModelProviderId = 'deepseek' | 'bailian' | 'custom';

export interface AgentModelCapabilities {
  text: boolean;
  streaming: boolean;
  tools: boolean;
  structuredOutput: boolean;
  reasoning: boolean;
  imageInput: boolean;
  audioInput: boolean;
}

export function agentRuntimeCompatible(capabilities: AgentModelCapabilities) {
  return capabilities.text && capabilities.streaming && capabilities.tools;
}

export interface AgentModelStreamInput<TOOLS extends ToolSet> {
  tier: RemoteAgentModelTier;
  system: string;
  messages: ModelMessage[];
  tools: TOOLS;
  signal?: AbortSignal;
}

interface AgentChatProviderShape {
  readonly id: AgentModelProviderId;
  readonly label: string;
  configured(): boolean;
  modelName(tier: AgentModelTier): string;
  capabilities(tier: RemoteAgentModelTier): AgentModelCapabilities;
  estimateCostCny(model: string, inputTokens: number, outputTokens: number): number;
}

const textToolCapabilities = (overrides: Partial<AgentModelCapabilities> = {}): AgentModelCapabilities => ({
  text: true,
  streaming: true,
  tools: true,
  structuredOutput: true,
  reasoning: false,
  imageInput: false,
  audioInput: false,
  ...overrides
});

function cost(inputTokens: number, outputTokens: number, inputPerMillion: number, outputPerMillion: number) {
  return inputTokens / 1_000_000 * inputPerMillion + outputTokens / 1_000_000 * outputPerMillion;
}

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function streamSettings<TOOLS extends ToolSet>(input: AgentModelStreamInput<TOOLS>) {
  return {
    system: input.system,
    messages: input.messages,
    tools: input.tools,
    toolChoice: 'auto' as const,
    maxOutputTokens: input.tier === 'plus' ? 1800 : 1000,
    abortSignal: input.signal,
    timeout: { totalMs: 60_000, chunkMs: 15_000 }
  };
}

export interface DeepSeekAgentConfig {
  apiKey: string | null;
  baseURL: string;
  flashModel: string;
  plusModel: string;
}

export function loadDeepSeekAgentConfig(env: NodeJS.ProcessEnv = process.env): DeepSeekAgentConfig {
  return {
    apiKey: env.DEEPSEEK_API_KEY?.trim() || null,
    baseURL: env.DEEPSEEK_BASE_URL?.trim() || 'https://api.deepseek.com',
    flashModel: env.DEEPSEEK_MODEL_FLASH?.trim() || 'deepseek-v4-flash',
    plusModel: env.DEEPSEEK_MODEL_PLUS?.trim() || 'deepseek-v4-pro'
  };
}

export function deepSeekToolProviderOptions() {
  // 珍奇当前由程序执行工具并生成确定性结果，不进行模型→工具→模型的第二轮。
  // 因此关闭思考模式，避免 DeepSeek 工具续轮要求 reasoning_content 回传而导致 400。
  return { deepseek: { thinking: { type: 'disabled' as const } } };
}

export class DeepSeekAgentModelProvider implements AgentChatProviderShape {
  readonly id = 'deepseek' as const;
  readonly label = 'DeepSeek';
  private readonly provider;

  constructor(readonly config = loadDeepSeekAgentConfig(), private readonly env: NodeJS.ProcessEnv = process.env) {
    this.provider = config.apiKey ? createDeepSeek({ apiKey: config.apiKey, baseURL: config.baseURL }) : null;
  }

  configured() { return Boolean(this.provider); }
  modelName(tier: AgentModelTier) { return tier === 'plus' ? this.config.plusModel : tier === 'flash' ? this.config.flashModel : 'local-fallback'; }
  capabilities(tier: RemoteAgentModelTier) {
    const model = this.modelName(tier);
    return textToolCapabilities({ reasoning: true, imageInput: /vision/i.test(model) });
  }
  stream<TOOLS extends ToolSet>(input: AgentModelStreamInput<TOOLS>) {
    if (!this.provider) throw new Error('DEEPSEEK_NOT_CONFIGURED');
    return streamText({
      model: this.provider(this.modelName(input.tier)),
      ...streamSettings(input),
      providerOptions: deepSeekToolProviderOptions()
    });
  }
  estimateCostCny(model: string, inputTokens: number, outputTokens: number) {
    const isPlus = model === this.config.plusModel;
    const inputRate = positiveNumber(this.env[isPlus ? 'DEEPSEEK_PLUS_INPUT_CNY_PER_M' : 'DEEPSEEK_FLASH_INPUT_CNY_PER_M'], isPlus ? 4 : 2);
    const outputRate = positiveNumber(this.env[isPlus ? 'DEEPSEEK_PLUS_OUTPUT_CNY_PER_M' : 'DEEPSEEK_FLASH_OUTPUT_CNY_PER_M'], isPlus ? 12 : 8);
    return cost(inputTokens, outputTokens, inputRate, outputRate);
  }
}

export class BailianAgentModelProvider implements AgentChatProviderShape {
  readonly id = 'bailian' as const;
  readonly label = '阿里云百炼';
  private readonly provider;

  constructor(readonly config = loadAgentProviderConfig(), private readonly env: NodeJS.ProcessEnv = process.env) {
    this.provider = config.apiKey ? createOpenAICompatible({ name: 'bailian', apiKey: config.apiKey, baseURL: config.baseURL }) : null;
  }

  configured() { return Boolean(this.provider); }
  modelName(tier: AgentModelTier) { return tier === 'plus' ? this.config.plusModel : tier === 'flash' ? this.config.flashModel : 'local-fallback'; }
  capabilities(_tier: RemoteAgentModelTier) { return textToolCapabilities({ reasoning: true }); }
  stream<TOOLS extends ToolSet>(input: AgentModelStreamInput<TOOLS>) {
    if (!this.provider) throw new Error('BAILIAN_NOT_CONFIGURED');
    return streamText({ model: this.provider(this.modelName(input.tier)), ...streamSettings(input) });
  }
  estimateCostCny(model: string, inputTokens: number, outputTokens: number) {
    const isPlus = model === this.config.plusModel;
    const inputRate = positiveNumber(this.env[isPlus ? 'BAILIAN_PLUS_INPUT_CNY_PER_M' : 'BAILIAN_FLASH_INPUT_CNY_PER_M'], isPlus ? 4 : 0.8);
    const outputRate = positiveNumber(this.env[isPlus ? 'BAILIAN_PLUS_OUTPUT_CNY_PER_M' : 'BAILIAN_FLASH_OUTPUT_CNY_PER_M'], isPlus ? 12 : 2);
    return cost(inputTokens, outputTokens, inputRate, outputRate);
  }
}

export interface OpenAICompatibleAgentConfig {
  apiKey: string | null;
  baseURL: string | null;
  flashModel: string | null;
  plusModel: string | null;
  providerName: string;
  capabilities: Set<keyof AgentModelCapabilities>;
}

export function loadOpenAICompatibleAgentConfig(env: NodeJS.ProcessEnv = process.env): OpenAICompatibleAgentConfig {
  const capabilities = new Set((env.OPENAI_COMPATIBLE_CAPABILITIES || 'text,streaming,tools,structuredOutput')
    .split(',').map(value => value.trim()).filter(Boolean) as Array<keyof AgentModelCapabilities>);
  return {
    apiKey: env.OPENAI_COMPATIBLE_API_KEY?.trim() || null,
    baseURL: env.OPENAI_COMPATIBLE_BASE_URL?.trim().replace(/\/$/, '') || null,
    flashModel: env.OPENAI_COMPATIBLE_MODEL_FLASH?.trim() || null,
    plusModel: env.OPENAI_COMPATIBLE_MODEL_PLUS?.trim() || env.OPENAI_COMPATIBLE_MODEL_FLASH?.trim() || null,
    providerName: env.OPENAI_COMPATIBLE_PROVIDER_NAME?.trim() || 'custom-agent-model',
    capabilities
  };
}

export class OpenAICompatibleAgentModelProvider implements AgentChatProviderShape {
  readonly id = 'custom' as const;
  readonly label: string;
  private readonly provider;

  constructor(readonly config = loadOpenAICompatibleAgentConfig(), private readonly env: NodeJS.ProcessEnv = process.env) {
    this.label = config.providerName;
    this.provider = config.apiKey && config.baseURL ? createOpenAICompatible({ name: config.providerName, apiKey: config.apiKey, baseURL: config.baseURL }) : null;
  }

  configured() { return Boolean(this.provider && this.config.flashModel && this.config.plusModel); }
  modelName(tier: AgentModelTier) { return tier === 'plus' ? this.config.plusModel || '' : tier === 'flash' ? this.config.flashModel || '' : 'local-fallback'; }
  capabilities(_tier: RemoteAgentModelTier) {
    const enabled = (name: keyof AgentModelCapabilities) => this.config.capabilities.has(name);
    return {
      text: enabled('text'), streaming: enabled('streaming'), tools: enabled('tools'), structuredOutput: enabled('structuredOutput'),
      reasoning: enabled('reasoning'), imageInput: enabled('imageInput'), audioInput: enabled('audioInput')
    };
  }
  stream<TOOLS extends ToolSet>(input: AgentModelStreamInput<TOOLS>) {
    if (!this.provider || !this.config.flashModel || !this.config.plusModel) throw new Error('OPENAI_COMPATIBLE_NOT_CONFIGURED');
    return streamText({ model: this.provider(this.modelName(input.tier)), ...streamSettings(input) });
  }
  estimateCostCny(model: string, inputTokens: number, outputTokens: number) {
    const isPlus = model === this.config.plusModel;
    const inputRate = positiveNumber(this.env[isPlus ? 'OPENAI_COMPATIBLE_PLUS_INPUT_CNY_PER_M' : 'OPENAI_COMPATIBLE_FLASH_INPUT_CNY_PER_M'], 0);
    const outputRate = positiveNumber(this.env[isPlus ? 'OPENAI_COMPATIBLE_PLUS_OUTPUT_CNY_PER_M' : 'OPENAI_COMPATIBLE_FLASH_OUTPUT_CNY_PER_M'], 0);
    return cost(inputTokens, outputTokens, inputRate, outputRate);
  }
}

export type AgentChatModelProvider = DeepSeekAgentModelProvider | BailianAgentModelProvider | OpenAICompatibleAgentModelProvider;

export interface AgentProviderStatus {
  id: AgentModelProviderId;
  label: string;
  configured: boolean;
  selected: boolean;
  runtimeCompatible: boolean;
  models: { flash: string; plus: string };
  capabilities: AgentModelCapabilities;
}

function requestedProviderId(env: NodeJS.ProcessEnv): AgentModelProviderId | 'auto' {
  const value = env.AGENT_MODEL_PROVIDER?.trim().toLocaleLowerCase() || 'auto';
  return value === 'deepseek' || value === 'bailian' || value === 'custom' ? value : 'auto';
}

export class AgentModelProviderRegistry {
  private readonly providers: AgentChatModelProvider[];
  private readonly requested: AgentModelProviderId | 'auto';

  constructor(private readonly env: NodeJS.ProcessEnv = process.env, providers?: AgentChatModelProvider[]) {
    this.providers = providers || [
      new DeepSeekAgentModelProvider(loadDeepSeekAgentConfig(env), env),
      new BailianAgentModelProvider(loadAgentProviderConfig(env), env),
      new OpenAICompatibleAgentModelProvider(loadOpenAICompatibleAgentConfig(env), env)
    ];
    this.requested = requestedProviderId(env);
  }

  selected(): AgentChatModelProvider | null {
    const usable = (provider: AgentChatModelProvider) => provider.configured() && agentRuntimeCompatible(provider.capabilities('plus'));
    if (this.requested !== 'auto') return this.providers.find(provider => provider.id === this.requested && usable(provider)) || null;
    return this.providers.find(usable) || null;
  }

  statuses(): AgentProviderStatus[] {
    const selected = this.selected();
    return this.providers.map(provider => ({
      id: provider.id,
      label: provider.label,
      configured: provider.configured(),
      selected: selected?.id === provider.id,
      runtimeCompatible: agentRuntimeCompatible(provider.capabilities('plus')),
      models: { flash: provider.modelName('flash'), plus: provider.modelName('plus') },
      capabilities: provider.capabilities('plus')
    }));
  }

  selectionMode() { return this.requested; }
}
