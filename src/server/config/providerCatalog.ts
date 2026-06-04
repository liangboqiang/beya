import { z } from 'zod'

import { ApiFormatSchema, ProviderAuthStrategySchema } from '../types/provider.js'

export const ModelTierSchema = z.enum(['small', 'medium', 'large'])
export type ModelTier = z.infer<typeof ModelTierSchema>

export const ModelRolesSchema = z.object({
  primary: z.string(),
  fast: z.string(),
  balanced: z.string(),
  powerful: z.string(),
})
export type ModelRoles = z.infer<typeof ModelRolesSchema>

export const ModelDefinitionSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  providerId: z.string().min(1),
  tier: ModelTierSchema,
  contextWindow: z.number().int().min(16000).max(10000000),
  maxOutputTokens: z.number().int().min(1).optional(),
  capabilities: z.array(z.string()).default([]),
  pricing: z.object({
    inputPer1k: z.number().min(0).optional(),
    outputPer1k: z.number().min(0).optional(),
    combinedPer1k: z.number().min(0).optional(),
  }).optional(),
})
export type ModelDefinition = z.infer<typeof ModelDefinitionSchema>

export const ProviderDefinitionSchema = z.object({
  providerId: z.string().min(1),
  displayName: z.string().min(1),
  group: z.enum(['official', 'cloud', 'local', 'custom']),
  baseUrl: z.string(),
  apiFormat: ApiFormatSchema,
  authStrategy: ProviderAuthStrategySchema.optional(),
  needsApiKey: z.boolean(),
  websiteUrl: z.string().optional(),
  apiKeyUrl: z.string().optional(),
  defaultModelRoles: ModelRolesSchema,
  defaultEnv: z.record(z.string(), z.string()).optional(),
  models: z.array(ModelDefinitionSchema),
})
export type ProviderDefinition = z.infer<typeof ProviderDefinitionSchema>

export const ProviderCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  providers: z.array(ProviderDefinitionSchema),
  modelTiers: z.record(
    ModelTierSchema,
    z.array(z.object({
      providerId: z.string().min(1),
      modelId: z.string().min(1),
    })),
  ),
})
export type ProviderCatalog = z.infer<typeof ProviderCatalogSchema>

const pricing = {
  default: { combinedPer1k: 0.005 },
  free: { inputPer1k: 0, outputPer1k: 0 },
} as const

function model(
  providerId: string,
  id: string,
  tier: ModelTier,
  contextWindow: number,
  capabilities: string[] = ['streaming', 'tools'],
  maxOutputTokens?: number,
  modelPricing?: ModelDefinition['pricing'],
): ModelDefinition {
  return {
    id,
    displayName: id,
    providerId,
    tier,
    contextWindow,
    ...(maxOutputTokens !== undefined && { maxOutputTokens }),
    capabilities,
    pricing: modelPricing ?? pricing.default,
  }
}

export const PROVIDER_CATALOG: ProviderCatalog = ProviderCatalogSchema.parse({
  schemaVersion: 1,
  providers: [
    {
      providerId: 'openai',
      displayName: 'OpenAI',
      group: 'official',
      baseUrl: 'https://api.openai.com/v1',
      apiFormat: 'openai_responses',
      authStrategy: 'api_key',
      needsApiKey: true,
      websiteUrl: 'https://platform.openai.com',
      apiKeyUrl: 'https://platform.openai.com/api-keys',
      defaultModelRoles: {
        primary: 'gpt-5.1',
        fast: 'gpt-5-nano-2025-08-07',
        balanced: 'gpt-5-mini-2025-08-07',
        powerful: 'gpt-5.1',
      },
      models: [
        model('openai', 'gpt-5-nano-2025-08-07', 'small', 400000, ['streaming', 'tools', 'vision'], 128000, { inputPer1k: 0.00005, outputPer1k: 0.0004 }),
        model('openai', 'gpt-5-mini-2025-08-07', 'medium', 400000, ['streaming', 'tools', 'vision'], 128000, { inputPer1k: 0.00025, outputPer1k: 0.002 }),
        model('openai', 'gpt-5.1', 'large', 400000, ['streaming', 'tools', 'vision', 'reasoning'], 128000, { inputPer1k: 0.00125, outputPer1k: 0.01 }),
      ],
    },
    {
      providerId: 'anthropic',
      displayName: 'Anthropic',
      group: 'official',
      baseUrl: 'https://api.anthropic.com',
      apiFormat: 'anthropic',
      authStrategy: 'api_key',
      needsApiKey: true,
      websiteUrl: 'https://console.anthropic.com',
      apiKeyUrl: 'https://console.anthropic.com/settings/keys',
      defaultModelRoles: {
        primary: 'claude-sonnet-4-6',
        fast: 'claude-haiku-4-5-20251001',
        balanced: 'claude-sonnet-4-6',
        powerful: 'claude-opus-4-6',
      },
      models: [
        model('anthropic', 'claude-haiku-4-5-20251001', 'small', 200000, ['streaming', 'tools', 'vision'], 8192, { inputPer1k: 0.001, outputPer1k: 0.005 }),
        model('anthropic', 'claude-sonnet-4-5-20250929', 'medium', 200000, ['streaming', 'tools', 'vision', 'thinking'], 8192, { inputPer1k: 0.003, outputPer1k: 0.015 }),
        model('anthropic', 'claude-sonnet-4-6', 'medium', 1000000, ['streaming', 'tools', 'vision', 'thinking'], 8192, { inputPer1k: 0.003, outputPer1k: 0.015 }),
        model('anthropic', 'claude-opus-4-6', 'large', 1000000, ['streaming', 'tools', 'vision', 'thinking'], 8192, { inputPer1k: 0.005, outputPer1k: 0.025 }),
      ],
    },
    {
      providerId: 'deepseek',
      displayName: 'DeepSeek',
      group: 'cloud',
      baseUrl: 'https://api.deepseek.com/v1',
      apiFormat: 'openai_chat',
      authStrategy: 'api_key',
      needsApiKey: true,
      websiteUrl: 'https://platform.deepseek.com',
      apiKeyUrl: 'https://platform.deepseek.com/api_keys',
      defaultModelRoles: {
        primary: 'deepseek-chat',
        fast: 'deepseek-chat',
        balanced: 'deepseek-chat',
        powerful: 'deepseek-reasoner',
      },
      defaultEnv: {
        ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES: 'thinking,effort,adaptive_thinking,max_effort',
        ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES: 'thinking,effort,adaptive_thinking,max_effort',
        ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES: 'thinking,effort,adaptive_thinking,max_effort',
      },
      models: [
        model('deepseek', 'deepseek-chat', 'medium', 128000, ['streaming', 'tools']),
        model('deepseek', 'deepseek-reasoner', 'large', 128000, ['streaming', 'tools', 'reasoning', 'thinking']),
      ],
    },
    {
      providerId: 'qwen',
      displayName: 'Qwen / DashScope',
      group: 'cloud',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiFormat: 'openai_chat',
      authStrategy: 'api_key',
      needsApiKey: true,
      websiteUrl: 'https://dashscope.aliyun.com',
      apiKeyUrl: 'https://dashscope.console.aliyun.com/apiKey',
      defaultModelRoles: {
        primary: 'qwen3-8b',
        fast: 'qwen3-4b-instruct-2507',
        balanced: 'qwen3-8b',
        powerful: 'qwen3-omni-30b-a3b-instruct',
      },
      models: [
        model('qwen', 'qwen3-4b-instruct-2507', 'small', 128000, ['streaming', 'tools']),
        model('qwen', 'qwen3-8b', 'medium', 128000, ['streaming', 'tools']),
        model('qwen', 'qwen3-omni-30b-a3b-instruct', 'large', 128000, ['streaming', 'tools', 'vision']),
      ],
    },
    {
      providerId: 'zai',
      displayName: 'Z.AI / GLM',
      group: 'cloud',
      baseUrl: 'https://api.z.ai/api/paas/v4',
      apiFormat: 'openai_chat',
      authStrategy: 'api_key',
      needsApiKey: true,
      websiteUrl: 'https://z.ai',
      defaultModelRoles: {
        primary: 'glm-4.7',
        fast: 'glm-4.7-flash',
        balanced: 'glm-4.7',
        powerful: 'glm-5',
      },
      defaultEnv: {
        BEYA_SEND_DISABLED_THINKING: '1',
      },
      models: [
        model('zai', 'glm-4.7-flash', 'small', 128000, ['streaming', 'tools'], undefined, pricing.free),
        model('zai', 'glm-4.7', 'medium', 128000, ['streaming', 'tools']),
        model('zai', 'glm-5', 'large', 200000, ['streaming', 'tools', 'reasoning']),
      ],
    },
    {
      providerId: 'kimi',
      displayName: 'Kimi / Moonshot',
      group: 'cloud',
      baseUrl: 'https://api.moonshot.ai/v1',
      apiFormat: 'openai_chat',
      authStrategy: 'api_key',
      needsApiKey: true,
      websiteUrl: 'https://platform.moonshot.ai',
      apiKeyUrl: 'https://platform.moonshot.ai/console/api-keys',
      defaultModelRoles: {
        primary: 'kimi-k2.5',
        fast: 'kimi-k2-turbo-preview',
        balanced: 'kimi-k2.5',
        powerful: 'kimi-k2-thinking',
      },
      defaultEnv: {
        BEYA_SEND_DISABLED_THINKING: '1',
      },
      models: [
        model('kimi', 'kimi-k2-turbo-preview', 'small', 262144, ['streaming', 'tools']),
        model('kimi', 'kimi-k2.5', 'medium', 262144, ['streaming', 'tools']),
        model('kimi', 'kimi-k2-thinking', 'large', 262144, ['streaming', 'tools', 'reasoning']),
      ],
    },
    {
      providerId: 'minimax',
      displayName: 'MiniMax',
      group: 'cloud',
      baseUrl: 'https://api.minimax.io/v1',
      apiFormat: 'openai_chat',
      authStrategy: 'api_key',
      needsApiKey: true,
      websiteUrl: 'https://platform.minimax.io',
      defaultModelRoles: {
        primary: 'MiniMax-M2.7',
        fast: 'MiniMax-M2.7-highspeed',
        balanced: 'MiniMax-M2.7',
        powerful: 'MiniMax-M2.7',
      },
      models: [
        model('minimax', 'MiniMax-M2.7-highspeed', 'small', 204800, ['streaming', 'tools']),
        model('minimax', 'MiniMax-M2.7', 'medium', 204800, ['streaming', 'tools']),
      ],
    },
    {
      providerId: 'google',
      displayName: 'Google Gemini',
      group: 'cloud',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiFormat: 'openai_chat',
      authStrategy: 'api_key',
      needsApiKey: true,
      websiteUrl: 'https://ai.google.dev',
      apiKeyUrl: 'https://aistudio.google.com/app/apikey',
      defaultModelRoles: {
        primary: 'gemini-2.5-flash',
        fast: 'gemini-2.5-flash-lite',
        balanced: 'gemini-2.5-flash',
        powerful: 'gemini-2.5-pro',
      },
      models: [
        model('google', 'gemini-2.5-flash-lite', 'small', 1000000, ['streaming', 'tools', 'vision']),
        model('google', 'gemini-2.5-flash', 'medium', 1000000, ['streaming', 'tools', 'vision']),
        model('google', 'gemini-2.5-pro', 'large', 2000000, ['streaming', 'tools', 'vision', 'reasoning']),
        model('google', 'gemini-3-pro-preview', 'large', 2000000, ['streaming', 'tools', 'vision', 'reasoning']),
      ],
    },
    {
      providerId: 'xai',
      displayName: 'xAI',
      group: 'cloud',
      baseUrl: 'https://api.x.ai/v1',
      apiFormat: 'openai_chat',
      authStrategy: 'api_key',
      needsApiKey: true,
      websiteUrl: 'https://x.ai/api',
      defaultModelRoles: {
        primary: 'grok-4-1-fast-non-reasoning',
        fast: 'grok-4-1-fast-non-reasoning',
        balanced: 'grok-4-1-fast-non-reasoning',
        powerful: 'grok-4-1-fast-reasoning',
      },
      models: [
        model('xai', 'grok-4-1-fast-non-reasoning', 'medium', 256000, ['streaming', 'tools']),
        model('xai', 'grok-4-1-fast-reasoning', 'large', 256000, ['streaming', 'tools', 'reasoning']),
      ],
    },
    {
      providerId: 'groq',
      displayName: 'Groq',
      group: 'cloud',
      baseUrl: 'https://api.groq.com/openai/v1',
      apiFormat: 'openai_chat',
      authStrategy: 'api_key',
      needsApiKey: true,
      websiteUrl: 'https://console.groq.com',
      apiKeyUrl: 'https://console.groq.com/keys',
      defaultModelRoles: {
        primary: 'llama-3.3-70b-versatile',
        fast: 'llama-3.1-8b-instant',
        balanced: 'llama-3.3-70b-versatile',
        powerful: 'openai/gpt-oss-120b',
      },
      models: [
        model('groq', 'llama-3.1-8b-instant', 'small', 128000, ['streaming', 'tools']),
        model('groq', 'llama-3.3-70b-versatile', 'medium', 128000, ['streaming', 'tools']),
        model('groq', 'openai/gpt-oss-120b', 'large', 128000, ['streaming', 'tools', 'reasoning']),
      ],
    },
    {
      providerId: 'meta',
      displayName: 'Together / Meta',
      group: 'cloud',
      baseUrl: 'https://api.together.xyz/v1',
      apiFormat: 'openai_chat',
      authStrategy: 'api_key',
      needsApiKey: true,
      websiteUrl: 'https://www.together.ai',
      defaultModelRoles: {
        primary: 'meta-llama/Llama-4-Scout-17B-16E-Instruct',
        fast: 'meta-llama/Llama-3.2-3B-Instruct-Turbo',
        balanced: 'meta-llama/Llama-4-Scout-17B-16E-Instruct',
        powerful: 'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo',
      },
      models: [
        model('meta', 'meta-llama/Llama-3.2-3B-Instruct-Turbo', 'small', 128000, ['streaming', 'tools']),
        model('meta', 'meta-llama/Llama-4-Scout-17B-16E-Instruct', 'medium', 1000000, ['streaming', 'tools', 'vision']),
        model('meta', 'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo', 'large', 128000, ['streaming', 'tools']),
      ],
    },
    {
      providerId: 'ollama',
      displayName: 'Ollama',
      group: 'local',
      baseUrl: 'http://localhost:11434/v1',
      apiFormat: 'openai_chat',
      authStrategy: 'api_key',
      needsApiKey: false,
      websiteUrl: 'https://docs.ollama.com/openai',
      defaultModelRoles: {
        primary: 'qwen3.1:8b',
        fast: 'qwen3.1:8b',
        balanced: 'qwen3.1:8b',
        powerful: 'llama3.1:70b',
      },
      models: [
        model('ollama', 'qwen3.1:8b', 'small', 128000, ['streaming', 'tools'], undefined, pricing.free),
        model('ollama', 'llama3.1:70b', 'large', 128000, ['streaming', 'tools'], undefined, pricing.free),
      ],
    },
    {
      providerId: 'lmstudio',
      displayName: 'LM Studio',
      group: 'local',
      baseUrl: 'http://localhost:1234/v1',
      apiFormat: 'openai_chat',
      authStrategy: 'api_key',
      needsApiKey: false,
      websiteUrl: 'https://lmstudio.ai/docs/app/api/endpoints/openai',
      defaultModelRoles: {
        primary: 'local-model',
        fast: 'local-model',
        balanced: 'local-model',
        powerful: 'local-model',
      },
      models: [
        model('lmstudio', 'local-model', 'medium', 200000, ['streaming', 'tools'], undefined, pricing.free),
      ],
    },
    {
      providerId: 'custom',
      displayName: 'Custom',
      group: 'custom',
      baseUrl: '',
      apiFormat: 'openai_chat',
      authStrategy: 'api_key',
      needsApiKey: true,
      defaultModelRoles: {
        primary: '',
        fast: '',
        balanced: '',
        powerful: '',
      },
      models: [],
    },
  ],
  modelTiers: {
    small: [
      { providerId: 'openai', modelId: 'gpt-5-nano-2025-08-07' },
      { providerId: 'anthropic', modelId: 'claude-haiku-4-5-20251001' },
      { providerId: 'google', modelId: 'gemini-2.5-flash-lite' },
      { providerId: 'deepseek', modelId: 'deepseek-chat' },
      { providerId: 'qwen', modelId: 'qwen3-4b-instruct-2507' },
      { providerId: 'kimi', modelId: 'kimi-k2-turbo-preview' },
      { providerId: 'minimax', modelId: 'MiniMax-M2.7-highspeed' },
    ],
    medium: [
      { providerId: 'anthropic', modelId: 'claude-sonnet-4-6' },
      { providerId: 'openai', modelId: 'gpt-5-mini-2025-08-07' },
      { providerId: 'google', modelId: 'gemini-2.5-flash' },
      { providerId: 'deepseek', modelId: 'deepseek-chat' },
      { providerId: 'qwen', modelId: 'qwen3-8b' },
      { providerId: 'zai', modelId: 'glm-4.7' },
      { providerId: 'kimi', modelId: 'kimi-k2.5' },
      { providerId: 'minimax', modelId: 'MiniMax-M2.7' },
    ],
    large: [
      { providerId: 'openai', modelId: 'gpt-5.1' },
      { providerId: 'anthropic', modelId: 'claude-opus-4-6' },
      { providerId: 'google', modelId: 'gemini-2.5-pro' },
      { providerId: 'deepseek', modelId: 'deepseek-reasoner' },
      { providerId: 'qwen', modelId: 'qwen3-omni-30b-a3b-instruct' },
      { providerId: 'zai', modelId: 'glm-5' },
      { providerId: 'kimi', modelId: 'kimi-k2-thinking' },
      { providerId: 'minimax', modelId: 'MiniMax-M2.7' },
    ],
  },
})

export function getProviderDefinition(providerId: string): ProviderDefinition | undefined {
  return PROVIDER_CATALOG.providers.find((provider) => provider.providerId === providerId)
}

export function getProviderModels(providerId: string): ModelDefinition[] {
  return getProviderDefinition(providerId)?.models ?? []
}

export function getModelContextWindows(providerId: string): Record<string, number> {
  return Object.fromEntries(
    getProviderModels(providerId).map((entry) => [entry.id, entry.contextWindow]),
  )
}
