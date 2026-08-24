import { describe, expect, it } from 'vitest';
import {
  AgentModelProviderRegistry,
  BailianAgentModelProvider,
  DeepSeekAgentModelProvider,
  OpenAICompatibleAgentModelProvider,
  deepSeekToolProviderOptions,
  loadDeepSeekAgentConfig,
  loadOpenAICompatibleAgentConfig
} from './agentModelProviders.js';
import { loadAgentProviderConfig } from './agentProviders.js';

describe('agent model providers', () => {
  it('uses current DeepSeek V4 model defaults without treating missing keys as configured', () => {
    const config = loadDeepSeekAgentConfig({});
    const provider = new DeepSeekAgentModelProvider(config, {});
    expect(config).toMatchObject({ baseURL: 'https://api.deepseek.com', flashModel: 'deepseek-v4-flash', plusModel: 'deepseek-v4-pro' });
    expect(provider.configured()).toBe(false);
    expect(provider.capabilities('plus')).toMatchObject({ text: true, tools: true, reasoning: true, imageInput: false, audioInput: false });
  });

  it('disables DeepSeek thinking for the current single-turn controlled tool protocol', () => {
    expect(deepSeekToolProviderOptions()).toEqual({ deepseek: { thinking: { type: 'disabled' } } });
  });

  it('does not leak a conversation to another remote provider when explicit selection is unavailable', () => {
    const env = { AGENT_MODEL_PROVIDER: 'deepseek' };
    const deepseek = new DeepSeekAgentModelProvider(loadDeepSeekAgentConfig(env), env);
    const bailianEnv = { BAILIAN_API_KEY: 'test-only' };
    const bailian = new BailianAgentModelProvider(loadAgentProviderConfig(bailianEnv), bailianEnv);
    const registry = new AgentModelProviderRegistry(env, [deepseek, bailian]);
    expect(registry.selected()).toBeNull();
    expect(registry.statuses().find(item => item.id === 'bailian')).toMatchObject({ configured: true, selected: false });
  });

  it('selects configured providers in deterministic order only when auto mode is requested', () => {
    const deepseekEnv = { DEEPSEEK_API_KEY: 'test-only' };
    const bailianEnv = { BAILIAN_API_KEY: 'test-only' };
    const deepseek = new DeepSeekAgentModelProvider(loadDeepSeekAgentConfig(deepseekEnv), deepseekEnv);
    const bailian = new BailianAgentModelProvider(loadAgentProviderConfig(bailianEnv), bailianEnv);
    const registry = new AgentModelProviderRegistry({ AGENT_MODEL_PROVIDER: 'auto' }, [deepseek, bailian]);
    expect(registry.selected()?.id).toBe('deepseek');
  });

  it('supports an arbitrary OpenAI-compatible endpoint with declared capabilities', () => {
    const env = {
      AGENT_MODEL_PROVIDER: 'custom',
      OPENAI_COMPATIBLE_API_KEY: 'test-only',
      OPENAI_COMPATIBLE_BASE_URL: 'https://models.example.test/v1/',
      OPENAI_COMPATIBLE_MODEL_FLASH: 'fast-model',
      OPENAI_COMPATIBLE_MODEL_PLUS: 'reasoning-model',
      OPENAI_COMPATIBLE_PROVIDER_NAME: 'my-provider',
      OPENAI_COMPATIBLE_CAPABILITIES: 'text,streaming,tools,reasoning,imageInput'
    };
    const config = loadOpenAICompatibleAgentConfig(env);
    const provider = new OpenAICompatibleAgentModelProvider(config, env);
    const registry = new AgentModelProviderRegistry(env, [provider]);
    expect(config.baseURL).toBe('https://models.example.test/v1');
    expect(registry.selected()?.modelName('plus')).toBe('reasoning-model');
    expect(provider.capabilities('plus')).toMatchObject({ tools: true, reasoning: true, imageInput: true, audioInput: false });
  });

  it('uses configurable provider-specific cost estimates', () => {
    const env = {
      DEEPSEEK_API_KEY: 'test-only',
      DEEPSEEK_FLASH_INPUT_CNY_PER_M: '3',
      DEEPSEEK_FLASH_OUTPUT_CNY_PER_M: '9'
    };
    const provider = new DeepSeekAgentModelProvider(loadDeepSeekAgentConfig(env), env);
    expect(provider.estimateCostCny(provider.modelName('flash'), 1_000_000, 500_000)).toBe(7.5);
  });
});
