/**
 * Provider types for preset-based provider configuration.
 *
 * Providers are stored in ~/.beya/beya/providers.json as a lightweight index.
 * The active provider's env vars are written to the compatibility settings file.
 */

import { z } from 'zod'

export const ApiFormatSchema = z.enum([
  'anthropic',         // Native Anthropic Messages API (passthrough, no proxy)
  'openai_chat',       // OpenAI Chat Completions /v1/chat/completions
  'openai_responses',  // OpenAI Responses API /v1/responses
])
export type ApiFormat = z.infer<typeof ApiFormatSchema>

export const ProviderAuthStrategySchema = z.enum([
  'api_key',
  'auth_token',
  'auth_token_empty_api_key',
  'dual_same_token',
  'dual_dummy',
])
export type ProviderAuthStrategy = z.infer<typeof ProviderAuthStrategySchema>

export const ProviderRuntimeKindSchema = z.enum([
  'anthropic_compatible',
])
export type ProviderRuntimeKind = z.infer<typeof ProviderRuntimeKindSchema>

export const ModelRolesSchema = z.object({
  primary: z.string(),
  fast: z.string(),
  balanced: z.string(),
  powerful: z.string(),
})

export const AutoCompactWindowSchema = z.number().int().min(16000).max(10000000)
export const ModelContextWindowsSchema = z.record(
  z.string().min(1),
  z.number().int().min(16000).max(10000000),
)

export const ConnectionOverridesSchema = z.object({
  baseUrl: z.string().optional(),
  apiFormat: ApiFormatSchema.optional(),
  authStrategy: ProviderAuthStrategySchema.optional(),
  runtimeKind: ProviderRuntimeKindSchema.optional(),
  defaultEnv: z.record(z.string(), z.string()).optional(),
}).optional()

export const SavedProviderSchema = z.object({
  providerId: z.string().min(1),
  displayName: z.string().min(1),
  apiKey: z.string(),
  authStrategy: ProviderAuthStrategySchema.optional(),
  baseUrl: z.string(),
  apiFormat: ApiFormatSchema.default('anthropic'),
  runtimeKind: ProviderRuntimeKindSchema.default('anthropic_compatible'),
  modelRoles: ModelRolesSchema,
  enabledModels: z.array(z.string().min(1)).default([]),
  connectionOverrides: ConnectionOverridesSchema,
  autoCompactWindow: AutoCompactWindowSchema.optional(),
  modelContextWindows: ModelContextWindowsSchema.optional(),
  notes: z.string().optional(),
})

export const ProvidersIndexSchema = z.object({
  schemaVersion: z.number().int().positive().optional(),
  activeId: z.string().nullable(),
  providers: z.array(SavedProviderSchema),
}).passthrough()

export const CreateProviderSchema = z.object({
  providerId: z.string().min(1),
  displayName: z.string().min(1),
  apiKey: z.string(),
  authStrategy: ProviderAuthStrategySchema.optional(),
  baseUrl: z.string(),
  apiFormat: ApiFormatSchema.default('anthropic'),
  runtimeKind: ProviderRuntimeKindSchema.default('anthropic_compatible'),
  modelRoles: ModelRolesSchema.optional(),
  enabledModels: z.array(z.string().min(1)).optional(),
  connectionOverrides: ConnectionOverridesSchema,
  autoCompactWindow: AutoCompactWindowSchema.optional(),
  modelContextWindows: ModelContextWindowsSchema.optional(),
  notes: z.string().optional(),
})

export const UpdateProviderSchema = z.object({
  displayName: z.string().min(1).optional(),
  apiKey: z.string().optional(),
  authStrategy: ProviderAuthStrategySchema.optional(),
  baseUrl: z.string().optional(),
  apiFormat: ApiFormatSchema.optional(),
  runtimeKind: ProviderRuntimeKindSchema.optional(),
  modelRoles: ModelRolesSchema.optional(),
  enabledModels: z.array(z.string().min(1)).optional(),
  connectionOverrides: ConnectionOverridesSchema,
  autoCompactWindow: AutoCompactWindowSchema.nullable().optional(),
  modelContextWindows: ModelContextWindowsSchema.nullable().optional(),
  notes: z.string().optional(),
})

export const TestProviderSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  modelId: z.string().min(1),
  authStrategy: ProviderAuthStrategySchema.optional(),
  apiFormat: ApiFormatSchema.default('anthropic'),
  scanModels: z.boolean().optional(),
})

// TypeScript types
export type ModelRoles = z.infer<typeof ModelRolesSchema>
export type ConnectionOverrides = z.infer<typeof ConnectionOverridesSchema>

export type SavedProvider = z.infer<typeof SavedProviderSchema>
export type ProvidersIndex = z.infer<typeof ProvidersIndexSchema>
export type CreateProviderInput = z.infer<typeof CreateProviderSchema>
export type UpdateProviderInput = z.infer<typeof UpdateProviderSchema>
export type TestProviderInput = z.infer<typeof TestProviderSchema>

export interface ProviderTestStepResult {
  success: boolean
  latencyMs: number
  error?: string
  modelUsed?: string
  httpStatus?: number
}

export interface ProviderDetectedModel {
  id: string
  label?: string
  contextWindow?: number
}

export interface ProviderTestResult {
  /** Step 1: Basic connectivity - API reachable, key valid, model exists */
  connectivity: ProviderTestStepResult
  /** Step 2: Proxy pipeline - full Anthropic/OpenAI/Anthropic round trip (only for openai_* formats) */
  proxy?: ProviderTestStepResult
  /** Dynamic model candidates returned by the upstream /models endpoint when requested. */
  availableModels?: ProviderDetectedModel[]
}
