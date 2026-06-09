import { describe, expect, it } from 'bun:test'
import {
  RuntimeResolutionError,
  RuntimeResolver,
  toProviderRuntimeProfile,
} from '../runtime/runtimeResolver.js'
import type { LocalCliRuntimeInfo } from '../services/localCliRuntimeService.js'
import type { SavedProvider } from '../types/provider.js'

function makeProvider(providerId: string, overrides: Partial<SavedProvider> = {}): SavedProvider {
  return {
    providerId,
    displayName: providerId,
    apiKey: 'test-key',
    authStrategy: 'api_key',
    baseUrl: `https://${providerId}.example.test`,
    apiFormat: 'openai_chat',
    runtimeKind: 'anthropic_compatible',
    enabledModels: [`${providerId}-model`],
    modelRoles: {
      primary: `${providerId}-model`,
      fast: `${providerId}-model`,
      balanced: `${providerId}-model`,
      powerful: `${providerId}-model`,
    },
    ...overrides,
  }
}

function makeLocalCli(id: string, overrides: Partial<LocalCliRuntimeInfo> = {}): LocalCliRuntimeInfo {
  return {
    id,
    displayName: `${id} CLI`,
    command: id,
    executablePath: `${id}.cmd`,
    launchPath: `${id}.cmd`,
    launchKind: 'selected',
    source: 'path',
    available: true,
    supportsDesktopRuntime: true,
    version: '1.0.0',
    config: {},
    models: [{ id: `${id}-model`, label: `${id} model` }],
    enabledModels: [`${id}-model`],
    modelRoles: {
      primary: `${id}-model`,
      fast: `${id}-model`,
      balanced: `${id}-model`,
      powerful: `${id}-model`,
    },
    ...overrides,
  }
}

describe('RuntimeResolver', () => {
  it('maps provider selections to provider runtime profiles and request policies', async () => {
    const providers = [
      makeProvider('deepseek', {
        enabledModels: ['deepseek-chat'],
        modelRoles: {
          primary: 'deepseek-chat',
          fast: 'deepseek-chat',
          balanced: 'deepseek-chat',
          powerful: 'deepseek-chat',
        },
      }),
      makeProvider('qwen'),
      makeProvider('custom'),
    ]
    const resolver = new RuntimeResolver(
      { listProviders: async () => ({ providers, activeId: 'deepseek' }) } as any,
      { listLocalClis: async () => ({ activeId: null, clis: [] }) } as any,
    )

    const deepseek = await resolver.resolve({ kind: 'provider', providerId: 'deepseek' })
    expect(deepseek.profile.kind).toBe('provider')
    expect(deepseek.profile.requestPolicy.reasoningMode).toBe('native')
    expect(deepseek.profile.requestPolicy.usageTrust).toBe('high')
    expect(deepseek.profile.capabilities.contextUsage).toBe('actual')
    expect(deepseek.profile.capabilities.prewarm).toBe(true)

    const qwen = await resolver.resolve({ kind: 'provider', providerId: 'qwen' })
    expect(qwen.profile.requestPolicy.reasoningMode).toBe('unsupported')
    expect(qwen.profile.requestPolicy.stripParams).toContain('thinking')
    expect(qwen.profile.requestPolicy.usageTrust).toBe('medium')
    expect(qwen.profile.capabilities.vision).toBe(false)

    const custom = await resolver.resolve({ kind: 'provider', providerId: 'custom' })
    expect(custom.profile.requestPolicy.reasoningMode).toBe('unsupported')
    expect(custom.profile.requestPolicy.usageTrust).toBe('low')
    expect(custom.profile.capabilities.thinking).toBe(false)
  })

  it('maps local CLI selections to local CLI runtime profiles', async () => {
    const codex = makeLocalCli('codex', {
      models: [{ id: 'gpt-5-codex', label: 'GPT-5 Codex' }],
      enabledModels: ['gpt-5-codex'],
      modelRoles: {
        primary: 'gpt-5-codex',
        fast: 'gpt-5-codex',
        balanced: 'gpt-5-codex',
        powerful: 'gpt-5-codex',
      },
    })
    const claude = makeLocalCli('claude')
    const resolver = new RuntimeResolver(
      { listProviders: async () => ({ providers: [], activeId: null }) } as any,
      { listLocalClis: async () => ({ activeId: 'codex', clis: [codex, claude] }) } as any,
    )

    const codexRuntime = await resolver.resolve({ kind: 'local_cli', localCliId: 'codex' })
    expect(codexRuntime.profile.kind).toBe('local_cli')
    expect(codexRuntime.profile.streamFormat).toBe('jsonl')
    expect(codexRuntime.profile.promptViaStdin).toBe(true)
    expect(codexRuntime.profile.resumesSessionViaCli).toBe(false)
    expect(codexRuntime.profile.capabilities.resume).toBe('beya_transcript')
    expect(codexRuntime.profile.capabilities.prewarm).toBe(false)
    expect(codexRuntime.profile.capabilities.tokenUsage).toBe('unavailable')
    expect(codexRuntime.profile.capabilities.contextUsage).toBe('unavailable')

    const claudeRuntime = await resolver.resolve({ kind: 'local_cli', localCliId: 'claude' })
    expect(claudeRuntime.profile.streamFormat).toBe('stream-json')
    expect(claudeRuntime.profile.promptInputFormat).toBe('stream-json')
    expect(claudeRuntime.profile.resumesSessionViaCli).toBe(true)
    expect(claudeRuntime.profile.capabilities.resume).toBe('native')
  })

  it('rejects provider defaults when no active provider is configured', async () => {
    const resolver = new RuntimeResolver(
      { listProviders: async () => ({ providers: [], activeId: null }) } as any,
      { listLocalClis: async () => ({ activeId: null, clis: [] }) } as any,
    )

    await expect(resolver.resolveDefault({ executionMode: 'provider' }))
      .rejects
      .toBeInstanceOf(RuntimeResolutionError)
  })

  it('keeps request policy generation centralized in provider profiles', () => {
    const profile = toProviderRuntimeProfile(makeProvider('qwen'))

    expect(profile.kind).toBe('provider')
    expect(profile.requestPolicy.reasoningMode).toBe('unsupported')
    expect(profile.requestPolicy.stripParams).toEqual(expect.arrayContaining([
      'thinking',
      'reasoning',
      'reasoning_effort',
      'thinking_budget',
    ]))
  })
})
