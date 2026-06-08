/**
 * Unit tests for ProviderService and Providers REST API
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { ProviderService } from '../services/providerService.js'
import { handleProvidersApi } from '../api/providers.js'
import { handleProxyRequest } from '../proxy/handler.js'
import type { CreateProviderInput } from '../types/provider.js'

// ─── Test helpers ─────────────────────────────────────────────────────────────

let tmpDir: string
let originalConfigDir: string | undefined

async function setup() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-test-'))
  originalConfigDir = process.env.BEYA_CONFIG_DIR
  process.env.BEYA_CONFIG_DIR = tmpDir
}

async function teardown() {
  if (originalConfigDir !== undefined) {
    process.env.BEYA_CONFIG_DIR = originalConfigDir
  } else {
    delete process.env.BEYA_CONFIG_DIR
  }
  await fs.rm(tmpDir, { recursive: true, force: true })
}

/** Create a mock Request */
function makeRequest(
  method: string,
  urlStr: string,
  body?: Record<string, unknown>,
): { req: Request; url: URL; segments: string[] } {
  const url = new URL(urlStr, 'http://localhost:3456')
  const init: RequestInit = { method }
  if (body) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const req = new Request(url.toString(), init)
  const segments = url.pathname.split('/').filter(Boolean)
  return { req, url, segments }
}

/** A sample provider input for reuse across tests */
function sampleInput(
  overrides?: Partial<CreateProviderInput> & {
    name?: string
    presetId?: string
  },
): CreateProviderInput {
  const { name, presetId, displayName, providerId, ...rest } = overrides ?? {}
  const resolvedDisplayName = displayName ?? name ?? 'Test Provider'
  const resolvedProviderId = providerId
    ?? presetId
    ?? resolvedDisplayName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    ?? 'test-provider'
  return {
    providerId: resolvedProviderId || 'test-provider',
    displayName: resolvedDisplayName,
    baseUrl: 'https://api.example.com',
    apiKey: 'sk-test-key-123',
    apiFormat: 'anthropic',
    modelRoles: {
      primary: 'model-primary',
      fast: 'model-fast',
      balanced: 'model-balanced',
      powerful: 'model-powerful',
    },
    ...rest,
  }
}

/** Read the settings.json written to the temp config dir */
async function readSettings(): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(path.join(tmpDir, 'beya', 'settings.json'), 'utf-8')
  return JSON.parse(raw) as Record<string, unknown>
}

/** Read the providers.json written to the temp config dir */
async function readProvidersConfig(): Promise<Record<string, unknown>> {
  const raw = await fs.readFile(path.join(tmpDir, 'beya', 'providers.json'), 'utf-8')
  return JSON.parse(raw) as Record<string, unknown>
}

// =============================================================================
// ProviderService
// =============================================================================

describe('ProviderService', () => {
  beforeEach(setup)
  afterEach(teardown)

  // ─── listProviders ───────────────────────────────────────────────────────

  describe('listProviders', () => {
    test('should return empty array when no providers exist', async () => {
      const svc = new ProviderService()
      const result = await svc.listProviders()
      expect(result).toEqual({ providers: [], activeId: null })
    })

    test('should recover from a malformed providers index after an upgrade', async () => {
      await fs.mkdir(path.join(tmpDir, 'beya'), { recursive: true })
      await fs.writeFile(path.join(tmpDir, 'beya', 'providers.json'), '{not json', 'utf-8')

      const svc = new ProviderService()
      const result = await svc.listProviders()
      const files = await fs.readdir(path.join(tmpDir, 'beya'))

      expect(result).toEqual({ providers: [], activeId: null })
      expect(files.some((name) => name.startsWith('providers.json.invalid-'))).toBe(true)
    })

    test('should ignore a legacy activeProviderId field while keeping valid providers', async () => {
      await fs.mkdir(path.join(tmpDir, 'beya'), { recursive: true })
      const provider = {
        ...sampleInput({ displayName: 'Legacy Provider' }),
      }
      await fs.writeFile(
        path.join(tmpDir, 'beya', 'providers.json'),
        JSON.stringify({ activeProviderId: provider.providerId, providers: [provider] }),
        'utf-8',
      )

      const svc = new ProviderService()
      const result = await svc.listProviders()

      expect(result.activeId).toBeNull()
      expect(result.providers).toHaveLength(1)
      expect(result.providers[0].displayName).toBe('Legacy Provider')
    })

    test('should return all added providers', async () => {
      const svc = new ProviderService()
      await svc.addProvider(sampleInput({ displayName: 'Provider A' }))
      await svc.addProvider(sampleInput({ displayName: 'Provider B' }))

      const { providers, activeId } = await svc.listProviders()
      expect(providers).toHaveLength(2)
      expect(providers[0].displayName).toBe('Provider A')
      expect(providers[1].displayName).toBe('Provider B')
      expect(activeId).toBeNull()
    })
  })

  // ─── addProvider ─────────────────────────────────────────────────────────

  describe('addProvider', () => {
    test('should add a provider and return it with generated fields', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput())

      expect(provider.providerId).toBeDefined()
      expect(provider.displayName).toBe('Test Provider')
      expect(provider.baseUrl).toBe('https://api.example.com')
      expect(provider.apiKey).toBe('sk-test-key-123')
      expect(provider.modelRoles.primary).toBe('model-primary')
      expect(provider.modelRoles.primary).toBe('model-primary')
    })

    test('should normalize empty model role slots to the primary model when adding a provider', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({
        modelRoles: {
          primary: 'gpt-5.5',
          fast: '',
          balanced: '   ',
          powerful: '',
        },
      }))

      expect(provider.modelRoles).toEqual({
        primary: 'gpt-5.5',
        fast: 'gpt-5.5',
        balanced: 'gpt-5.5',
        powerful: 'gpt-5.5',
      })

      const config = await readProvidersConfig()
      expect((config.providers as Array<{ modelRoles: unknown; models?: unknown }>)[0]?.modelRoles).toEqual(provider.modelRoles)
      expect((config.providers as Array<{ models?: unknown }>)[0]?.models).toBeUndefined()
    })

    test('should use catalog default model roles when adding a preset without explicit mappings', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider({
        providerId: 'openai',
        displayName: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test-key-123',
        apiFormat: 'openai_responses',
      })

      expect(provider.modelRoles).toEqual({
        primary: 'gpt-5.1',
        fast: 'gpt-5-nano-2025-08-07',
        balanced: 'gpt-5-mini-2025-08-07',
        powerful: 'gpt-5.1',
      })
      expect(provider.enabledModels).toEqual([
        'gpt-5.1',
        'gpt-5-nano-2025-08-07',
        'gpt-5-mini-2025-08-07',
      ])
    })

    test('new providers should not be auto-activated', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput())

      expect(provider.providerId).toBeDefined()
      const { activeId } = await svc.listProviders()
      expect(activeId).toBeNull()
    })

    test('adding a provider should not sync settings until activated', async () => {
      const svc = new ProviderService()
      await svc.addProvider(sampleInput())

      await expect(fs.readFile(path.join(tmpDir, 'beya', 'settings.json'), 'utf-8')).rejects.toThrow()
    })

    test('custom providers declare thinking and effort capability passthrough for user-defined models', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({
        providerId: 'custom',
        modelRoles: {
          primary: 'deepseek-ai/DeepSeek-V4-Pro',
          fast: 'deepseek-ai/DeepSeek-V4-Pro',
          balanced: 'deepseek-ai/DeepSeek-V4-Pro',
          powerful: 'deepseek-ai/DeepSeek-V4-Pro',
        },
      }))

      await svc.activateProvider(provider.providerId)

      const settings = await readSettings()
      const env = settings.env as Record<string, string>
      expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('deepseek-ai/DeepSeek-V4-Pro')
      expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES).toBe(
        'thinking,effort,adaptive_thinking,max_effort',
      )
      expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES).toBe(
        'thinking,effort,adaptive_thinking,max_effort',
      )
      expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES).toBe(
        'thinking,effort,adaptive_thinking,max_effort',
      )
    })

    test('DeepSeek preset follows the global thinking toggle instead of forcing disabled thinking', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({
        providerId: 'deepseek',
        displayName: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com/anthropic',
        modelRoles: {
          primary: 'deepseek-v4-pro',
          fast: 'deepseek-v4-flash',
          balanced: 'deepseek-v4-pro',
          powerful: 'deepseek-v4-pro',
        },
      }))

      await svc.activateProvider(provider.providerId)

      const settings = await readSettings()
      const env = settings.env as Record<string, string>
      expect(env.BEYA_SEND_DISABLED_THINKING).toBeUndefined()
      expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES).toBe(
        'thinking,effort,adaptive_thinking,max_effort',
      )
      expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES).toBe(
        'thinking,effort,adaptive_thinking,max_effort',
      )
      expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES).toBe(
        'thinking,effort,adaptive_thinking,max_effort',
      )
    })

    test('adding additional providers should keep activeId unchanged', async () => {
      const svc = new ProviderService()
      await svc.addProvider(sampleInput({ displayName: 'First' }))
      const second = await svc.addProvider(sampleInput({ displayName: 'Second' }))

      expect(second.providerId).toBeDefined()
      const { activeId } = await svc.listProviders()
      expect(activeId).toBeNull()
    })

    test('should preserve optional notes field', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({ notes: 'dev environment' }))

      expect(provider.notes).toBe('dev environment')
    })

    test('should preserve optional auto compact window', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({ autoCompactWindow: 64000 }))

      expect(provider.autoCompactWindow).toBe(64000)
    })

    test('should preserve optional model context windows', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({
        modelContextWindows: {
          'model-main': 300000,
          'model-fast': 128000,
        },
      }))

      expect(provider.modelContextWindows).toEqual({
        'model-main': 300000,
        'model-fast': 128000,
      })
    })
  })

  // ─── getProvider ─────────────────────────────────────────────────────────

  describe('getProvider', () => {
    test('should return the provider by id', async () => {
      const svc = new ProviderService()
      const added = await svc.addProvider(sampleInput())

      const fetched = await svc.getProvider(added.providerId)
      expect(fetched.providerId).toBe(added.providerId)
      expect(fetched.displayName).toBe(added.displayName)
    })

    describe('legacy ChatGPT Official provider id', () => {
      test('normalizes the removed built-in ChatGPT provider to no active provider', async () => {
        await fs.mkdir(path.join(tmpDir, 'beya'), { recursive: true })
        await fs.writeFile(
          path.join(tmpDir, 'beya', 'providers.json'),
          JSON.stringify({ activeId: 'openai-official', providers: [] }),
          'utf-8',
        )

        const svc = new ProviderService()
        const result = await svc.listProviders()

        expect(result.activeId).toBeNull()
        expect(result.providers).toEqual([])
      })

      test('does not return or activate the removed built-in ChatGPT provider', async () => {
        const svc = new ProviderService()
        await expect(svc.getProvider('openai-official')).rejects.toMatchObject({ statusCode: 404 })
        await expect(svc.activateProvider('openai-official')).rejects.toMatchObject({ statusCode: 404 })
      })
    })

    test('should throw 404 for non-existent id', async () => {
      const svc = new ProviderService()

      try {
        await svc.getProvider('non-existent-id')
        expect(true).toBe(false) // should not reach here
      } catch (err: unknown) {
        const apiErr = err as { statusCode: number }
        expect(apiErr.statusCode).toBe(404)
      }
    })
  })

  // ─── updateProvider ──────────────────────────────────────────────────────

  describe('updateProvider', () => {
    test('should update provider fields', async () => {
      const svc = new ProviderService()
      const added = await svc.addProvider(sampleInput())

      const updated = await svc.updateProvider(added.providerId, {
        displayName: 'Updated Name',
        baseUrl: 'https://new-api.example.com',
      })

      expect(updated.displayName).toBe('Updated Name')
      expect(updated.baseUrl).toBe('https://new-api.example.com')
      // unchanged fields preserved
      expect(updated.apiKey).toBe('sk-test-key-123')
    })

    test('should throw 404 for non-existent provider', async () => {
      const svc = new ProviderService()

      try {
        await svc.updateProvider('non-existent-id', { displayName: 'X' })
        expect(true).toBe(false)
      } catch (err: unknown) {
        const apiErr = err as { statusCode: number }
        expect(apiErr.statusCode).toBe(404)
      }
    })

    test('updating active provider should re-sync settings.json', async () => {
      const svc = new ProviderService()
      const added = await svc.addProvider(sampleInput())
      await svc.activateProvider(added.providerId)

      await svc.updateProvider(added.providerId, {
        baseUrl: 'https://new-api.example.com',
        apiKey: 'sk-new-key',
      })

      const settings = await readSettings()
      const env = settings.env as Record<string, string>
      expect(env.ANTHROPIC_BASE_URL).toBe('https://new-api.example.com')
      expect(env.ANTHROPIC_API_KEY).toBe('sk-new-key')
      expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
      expect(env.ANTHROPIC_MODEL).toBe('model-primary')
    })

    test('updating active provider should override and clear auto compact window', async () => {
      const svc = new ProviderService()
      const added = await svc.addProvider(sampleInput({ autoCompactWindow: 64000 }))
      await svc.activateProvider(added.providerId)

      let settings = await readSettings()
      let env = settings.env as Record<string, string>
      expect(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe('64000')

      await svc.updateProvider(added.providerId, { autoCompactWindow: 32000 })

      settings = await readSettings()
      env = settings.env as Record<string, string>
      expect(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe('32000')

      await svc.updateProvider(added.providerId, { autoCompactWindow: null })

      settings = await readSettings()
      env = settings.env as Record<string, string>
      expect(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBeUndefined()
    })

    test('should normalize empty model mappings before syncing settings', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({
        modelRoles: {
          primary: 'gpt-5.5',
          fast: '',
          balanced: '',
          powerful: '',
        },
      }))

      await svc.activateProvider(provider.providerId)

      const settings = await readSettings()
      const env = settings.env as Record<string, string>
      expect(env.ANTHROPIC_MODEL).toBe('gpt-5.5')
      expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('gpt-5.5')
      expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('gpt-5.5')
      expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('gpt-5.5')
    })

    test('updating active provider should override and clear model context windows', async () => {
      const svc = new ProviderService()
      const added = await svc.addProvider(sampleInput({
        modelContextWindows: { 'model-main': 300000 },
      }))
      await svc.activateProvider(added.providerId)

      let settings = await readSettings()
      let env = settings.env as Record<string, string>
      expect(JSON.parse(env.CLAUDE_CODE_MODEL_CONTEXT_WINDOWS)).toEqual({
        'model-main': 300000,
      })

      await svc.updateProvider(added.providerId, {
        modelContextWindows: { 'model-main': 500000 },
      })

      settings = await readSettings()
      env = settings.env as Record<string, string>
      expect(JSON.parse(env.CLAUDE_CODE_MODEL_CONTEXT_WINDOWS)).toEqual({
        'model-main': 500000,
      })

      await svc.updateProvider(added.providerId, { modelContextWindows: null })

      settings = await readSettings()
      env = settings.env as Record<string, string>
      expect(env.CLAUDE_CODE_MODEL_CONTEXT_WINDOWS).toBeUndefined()
    })
  })

  // ─── deleteProvider ──────────────────────────────────────────────────────

  describe('deleteProvider', () => {
    test('should delete an inactive provider', async () => {
      const svc = new ProviderService()
      await svc.addProvider(sampleInput({ displayName: 'First' }))
      const second = await svc.addProvider(sampleInput({ displayName: 'Second' }))

      // Second is inactive, so deletion should succeed
      await svc.deleteProvider(second.providerId)

      const { providers } = await svc.listProviders()
      expect(providers).toHaveLength(1)
      expect(providers[0].displayName).toBe('First')
    })

    test('should delete an active provider and clear managed settings', async () => {
      const svc = new ProviderService()
      const active = await svc.addProvider(sampleInput())
      await svc.activateProvider(active.providerId)

      await svc.deleteProvider(active.providerId)

      const { activeId, providers } = await svc.listProviders()
      expect(activeId).toBe(null)
      expect(providers).toHaveLength(0)
      const settings = await readSettings()
      const env = settings.env as Record<string, string>
      expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
      expect(env.ANTHROPIC_API_KEY).toBeUndefined()
      expect(env.ANTHROPIC_MODEL).toBeUndefined()
    })

    test('should throw 404 when deleting non-existent provider', async () => {
      const svc = new ProviderService()

      try {
        await svc.deleteProvider('non-existent-id')
        expect(true).toBe(false)
      } catch (err: unknown) {
        const apiErr = err as { statusCode: number }
        expect(apiErr.statusCode).toBe(404)
      }
    })
  })

  // ─── activateProvider ────────────────────────────────────────────────────

  describe('activateProvider', () => {
    test('should activate a provider with a valid model', async () => {
      const svc = new ProviderService()
      const first = await svc.addProvider(sampleInput({ displayName: 'First' }))
      const second = await svc.addProvider(
        sampleInput({
          displayName: 'Second',
          baseUrl: 'https://second-api.example.com',
          apiKey: 'sk-second-key',
        }),
      )

      await svc.activateProvider(second.providerId)

      // Second should now be active
      const { activeId, providers } = await svc.listProviders()
      expect(activeId).toBe(second.providerId)
      expect(providers.find((p) => p.providerId === first.providerId)).toBeDefined()
      expect(providers.find((p) => p.providerId === second.providerId)).toBeDefined()
    })

    test('should write correct settings.json on activation', async () => {
      const svc = new ProviderService()
      await svc.addProvider(sampleInput({ displayName: 'First' }))
      const second = await svc.addProvider(
        sampleInput({
          displayName: 'Second',
          baseUrl: 'https://second-api.example.com',
          apiKey: 'sk-second-key',
        }),
      )

      await svc.activateProvider(second.providerId)

      const settings = await readSettings()
      const env = settings.env as Record<string, string>
      expect(env.ANTHROPIC_BASE_URL).toBe('https://second-api.example.com')
      expect(env.ANTHROPIC_API_KEY).toBe('sk-second-key')
      expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
      expect(env.ANTHROPIC_MODEL).toBe('model-primary')
      expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('model-fast')
      expect(env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe('model-balanced')
      expect(env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe('model-powerful')
      expect(env.CLAUDE_CODE_ATTRIBUTION_HEADER).toBe('0')
      expect(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBeUndefined()
    })

    test('should preserve attribution header for real upstream provider models', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({
        modelRoles: {
          primary: 'claude-sonnet-4-6',
          fast: 'claude-haiku-4-5',
          balanced: 'claude-sonnet-4-6',
          powerful: 'claude-opus-4-7',
        },
      }))

      await svc.activateProvider(provider.providerId)

      const settings = await readSettings()
      const env = settings.env as Record<string, string>
      expect(env.CLAUDE_CODE_ATTRIBUTION_HEADER).toBe('1')

      const runtimeEnv = await svc.getProviderRuntimeEnv(provider.providerId)
      expect(runtimeEnv.CLAUDE_CODE_ATTRIBUTION_HEADER).toBe('1')
    })

    test('should honor provider auth env strategies on activation and runtime env', async () => {
      const svc = new ProviderService()

      const apiKeyProvider = await svc.addProvider(sampleInput({
        apiKey: 'sk-api-key',
        authStrategy: 'api_key',
      }))
      await svc.activateProvider(apiKeyProvider.providerId)
      let env = (await readSettings()).env as Record<string, string>
      expect(env.ANTHROPIC_API_KEY).toBe('sk-api-key')
      expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()

      const bearerProvider = await svc.addProvider(sampleInput({
        apiKey: 'sk-bearer',
        authStrategy: 'auth_token_empty_api_key',
      }))
      await svc.activateProvider(bearerProvider.providerId)
      env = (await readSettings()).env as Record<string, string>
      expect(env.ANTHROPIC_API_KEY).toBe('')
      expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-bearer')

      const dualProvider = await svc.addProvider(sampleInput({
        apiKey: 'sk-dual',
        authStrategy: 'dual_same_token',
      }))
      const runtimeEnv = await svc.getProviderRuntimeEnv(dualProvider.providerId)
      expect(runtimeEnv.ANTHROPIC_API_KEY).toBe('sk-dual')
      expect(runtimeEnv.ANTHROPIC_AUTH_TOKEN).toBe('sk-dual')

      const dummyProvider = await svc.addProvider(sampleInput({
        apiKey: '',
        authStrategy: 'dual_dummy',
      }))
      const dummyRuntimeEnv = await svc.getProviderRuntimeEnv(dummyProvider.providerId)
      expect(dummyRuntimeEnv.ANTHROPIC_API_KEY).toBe('dummy')
      expect(dummyRuntimeEnv.ANTHROPIC_AUTH_TOKEN).toBe('dummy')
    })

    test('proxy providers keep proxy-managed auth regardless of auth strategy', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({
        apiFormat: 'openai_chat',
        authStrategy: 'auth_token',
      }))

      await svc.activateProvider(provider.providerId)

      const settings = await readSettings()
      const env = settings.env as Record<string, string>
      expect(env.ANTHROPIC_API_KEY).toBe('proxy-managed')
      expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    })

    test('should include catalog context metadata on activation and runtime env', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({
        providerId: 'deepseek',
        displayName: 'DeepSeek',
        baseUrl: 'https://api.deepseek.com/v1',
        apiFormat: 'openai_chat',
        modelRoles: {
          primary: 'deepseek-chat',
          fast: 'deepseek-chat',
          balanced: 'deepseek-chat',
          powerful: 'deepseek-reasoner',
        },
      }))

      await svc.activateProvider(provider.providerId)

      const settings = await readSettings()
      const env = settings.env as Record<string, string>
      expect(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBeUndefined()
      expect(JSON.parse(env.CLAUDE_CODE_MODEL_CONTEXT_WINDOWS)).toEqual({
        'deepseek-chat': 128000,
        'deepseek-reasoner': 128000,
      })
      expect(env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:3456/proxy')
      expect(env.ANTHROPIC_API_KEY).toBe('proxy-managed')

      const runtimeEnv = await svc.getProviderRuntimeEnv(provider.providerId)
      expect(runtimeEnv.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBeUndefined()
      expect(JSON.parse(runtimeEnv.CLAUDE_CODE_MODEL_CONTEXT_WINDOWS)).toEqual({
        'deepseek-chat': 128000,
        'deepseek-reasoner': 128000,
      })
      expect(runtimeEnv.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:3456/proxy/providers/deepseek')
      expect(runtimeEnv.ANTHROPIC_API_KEY).toBe('proxy-managed')

      await svc.deactivateProvider()
      const clearedSettings = await readSettings()
      const clearedEnv = (clearedSettings.env as Record<string, string> | undefined) ?? {}
      expect(clearedEnv.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBeUndefined()
      expect(clearedEnv.CLAUDE_CODE_ATTRIBUTION_HEADER).toBeUndefined()
      expect(clearedEnv.CLAUDE_CODE_MODEL_CONTEXT_WINDOWS).toBeUndefined()
    })

    test('auth status treats preset default auth as active provider auth', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({
        providerId: 'lmstudio',
        apiKey: '',
        baseUrl: 'http://localhost:1234/v1',
        apiFormat: 'openai_chat',
        authStrategy: 'api_key',
        modelRoles: {
          primary: 'lmstudio-model',
          fast: 'lmstudio-model',
          balanced: 'lmstudio-model',
          powerful: 'lmstudio-model',
        },
      }))
      await svc.activateProvider(provider.providerId)

      const status = await svc.checkAuthStatus()

      expect(status).toEqual({
        hasAuth: true,
        source: 'beya-provider',
        activeProvider: provider.displayName,
      })
    })

    test('auth status treats dummy proxy auth as active provider auth', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({
        apiKey: '',
        apiFormat: 'openai_chat',
      }))
      await svc.activateProvider(provider.providerId)

      const status = await svc.checkAuthStatus()

      expect(status).toEqual({
        hasAuth: true,
        source: 'beya-provider',
        activeProvider: provider.displayName,
      })
    })

    test('provider auto compact window should override preset default env on activation and runtime env', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput({
        providerId: 'custom',
        autoCompactWindow: 32000,
      }))

      await svc.activateProvider(provider.providerId)

      const settings = await readSettings()
      const env = settings.env as Record<string, string>
      expect(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe('32000')

      const runtimeEnv = await svc.getProviderRuntimeEnv(provider.providerId)
      expect(runtimeEnv.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe('32000')
    })

    test('should preserve existing settings.json fields on activation', async () => {
      // Pre-seed settings with an extra field
      await fs.mkdir(path.join(tmpDir, 'beya'), { recursive: true })
      await fs.writeFile(
        path.join(tmpDir, 'beya', 'settings.json'),
        JSON.stringify({ theme: 'dark', env: { CUSTOM_VAR: 'keep-me' } }),
      )

      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput())

      // Re-activate to verify merge behavior
      await svc.activateProvider(provider.providerId)

      const settings = await readSettings()
      expect(settings.theme).toBe('dark')
      const env = settings.env as Record<string, string>
      expect(env.CUSTOM_VAR).toBe('keep-me')
      expect(env.ANTHROPIC_BASE_URL).toBe('https://api.example.com')
    })

    test('should recover malformed managed settings before activation sync', async () => {
      await fs.mkdir(path.join(tmpDir, 'beya'), { recursive: true })
      await fs.writeFile(path.join(tmpDir, 'beya', 'settings.json'), '{not json', 'utf-8')

      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput())

      await svc.activateProvider(provider.providerId)

      const settings = await readSettings()
      const env = settings.env as Record<string, string>
      const files = await fs.readdir(path.join(tmpDir, 'beya'))

      expect(env.ANTHROPIC_BASE_URL).toBe('https://api.example.com')
      expect(files.some((name) => name.startsWith('settings.json.invalid-'))).toBe(true)
    })

    test('should throw 404 for non-existent provider id', async () => {
      const svc = new ProviderService()

      try {
        await svc.activateProvider('non-existent-id')
        expect(true).toBe(false)
      } catch (err: unknown) {
        const apiErr = err as { statusCode: number }
        expect(apiErr.statusCode).toBe(404)
      }
    })

    test('activeId should be persisted in providers.json', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput())

      await svc.activateProvider(provider.providerId)

      const config = await readProvidersConfig()
      expect(config.activeId).toBe(provider.providerId)
    })
  })

  // ─── getProviderForProxy ─────────────────────────────────────────────────

  describe('getProviderForProxy', () => {
    test('should return null when no provider is active', async () => {
      const svc = new ProviderService()
      const active = await svc.getProviderForProxy()
      expect(active).toBeNull()
    })

    test('should reject explicit lookup for removed ChatGPT Official provider id', async () => {
      const svc = new ProviderService()

      await expect(svc.getProviderForProxy('openai-official')).rejects.toMatchObject({ statusCode: 404 })
    })

    test('should return the active provider proxy config', async () => {
      const svc = new ProviderService()
      const provider = await svc.addProvider(sampleInput())
      await svc.activateProvider(provider.providerId)

      const active = await svc.getProviderForProxy()
      expect(active).not.toBeNull()
      expect(active!.baseUrl).toBe(provider.baseUrl)
      expect(active!.apiKey).toBe(provider.apiKey)
      expect(active!.apiFormat).toBe('anthropic')
    })

    test('should return null when a stale ChatGPT Official active id is normalized away', async () => {
      await fs.mkdir(path.join(tmpDir, 'beya'), { recursive: true })
      await fs.writeFile(
        path.join(tmpDir, 'beya', 'providers.json'),
        JSON.stringify({ activeId: 'openai-official', providers: [] }),
        'utf-8',
      )
      const svc = new ProviderService()

      const active = await svc.getProviderForProxy()

      expect(active).toBeNull()
    })
  })

  describe('handleProxyRequest', () => {
    test('injects Beya billing attribution with compat version and signed CCH', async () => {
      const originalFetch = globalThis.fetch
      const originalEntrypoint = process.env.CLAUDE_CODE_ENTRYPOINT
      delete process.env.CLAUDE_CODE_ENTRYPOINT
      const calls: Array<{ body: Record<string, unknown> }> = []
      globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
        calls.push({ body: JSON.parse(String(init?.body)) as Record<string, unknown> })
        return new Response(JSON.stringify({
          id: 'chatcmpl-1',
          object: 'chat.completion',
          created: 0,
          model: 'gpt-4',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }) as typeof fetch

      try {
        const svc = new ProviderService()
        const provider = await svc.addProvider(sampleInput({ apiFormat: 'openai_chat' }))
        await svc.activateProvider(provider.providerId)

        const req = new Request('http://localhost:3456/proxy/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-4',
            max_tokens: 64,
            messages: [{ role: 'user', content: 'hello from proxy' }],
          }),
        })

        const res = await handleProxyRequest(req, new URL(req.url))
        expect(res.status).toBe(200)

        const system = calls[0].body.messages as Array<Record<string, string>>
        expect(system[0].role).toBe('system')
        expect(system[0].content).toMatch(
          /^x-anthropic-billing-header: cc_version=2\.1\.92\.693; cc_entrypoint=unknown; cch=[0-9a-f]{5};$/,
        )
      } finally {
        globalThis.fetch = originalFetch
        if (originalEntrypoint === undefined) delete process.env.CLAUDE_CODE_ENTRYPOINT
        else process.env.CLAUDE_CODE_ENTRYPOINT = originalEntrypoint
      }
    })

    test('omits image_url parts for DeepSeek OpenAI Chat proxy requests', async () => {
      const originalFetch = globalThis.fetch
      const calls: Array<{ body: Record<string, unknown> }> = []
      globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
        calls.push({ body: JSON.parse(String(init?.body)) as Record<string, unknown> })
        return new Response(JSON.stringify({
          id: 'chatcmpl-1',
          object: 'chat.completion',
          created: 0,
          model: 'deepseek-v4-pro',
          choices: [{ index: 0, message: { role: 'assistant', content: 'I cannot view images.' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }) as typeof fetch

      try {
        const svc = new ProviderService()
        const provider = await svc.addProvider(sampleInput({
          apiFormat: 'openai_chat',
          baseUrl: 'https://api.deepseek.com',
          modelRoles: {
            primary: 'deepseek-v4-pro',
            fast: 'deepseek-v4-pro',
            balanced: 'deepseek-v4-pro',
            powerful: 'deepseek-v4-pro',
          },
        }))
        await svc.activateProvider(provider.providerId)

        const req = new Request('http://localhost:3456/proxy/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'deepseek-v4-pro',
            max_tokens: 64,
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: 'What is in this screenshot?' },
                { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } },
              ],
            }],
          }),
        })

        const res = await handleProxyRequest(req, new URL(req.url))
        expect(res.status).toBe(200)

        const serialized = JSON.stringify(calls[0].body)
        expect(serialized).not.toContain('image_url')
        expect(serialized).not.toContain('abc123')
        expect(serialized).toContain('What is in this screenshot?')
        expect(serialized).toContain('Image omitted')
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  describe('testProvider', () => {
    test('should use local auth for saved no-key OpenAI-compatible providers', async () => {
      const originalFetch = globalThis.fetch
      const calls: Array<{ headers: Record<string, string> }> = []
      globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
        calls.push({ headers: init?.headers as Record<string, string> })
        return new Response(JSON.stringify({
          id: 'chatcmpl-test',
          object: 'chat.completion',
          model: 'lmstudio-model',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'ok' },
              finish_reason: 'stop',
            },
          ],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }) as typeof fetch

      try {
        const svc = new ProviderService()
        const provider = await svc.addProvider(sampleInput({
          providerId: 'lmstudio',
          apiKey: '',
          baseUrl: 'http://localhost:1234/v1',
          apiFormat: 'openai_chat',
          authStrategy: 'api_key',
          modelRoles: {
            primary: 'lmstudio-model',
            fast: 'lmstudio-model',
            balanced: 'lmstudio-model',
            powerful: 'lmstudio-model',
          },
        }))

        const result = await svc.testProvider(provider.providerId)

        expect(result.connectivity.success).toBe(true)
        expect(calls[0].headers.Authorization).toBe('Bearer local')
        expect(calls[0].headers['x-api-key']).toBeUndefined()
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test('should refresh saved provider candidates from the upstream model scan after a successful test', async () => {
      const originalFetch = globalThis.fetch
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        if (String(url).endsWith('/v1/models')) {
          return new Response(JSON.stringify({
            data: [
              { id: 'deepseek-chat', display_name: 'DeepSeek Chat', context_window: 128000 },
              { id: 'deepseek-reasoner', display_name: 'DeepSeek Reasoner', context_window: 128000 },
            ],
          }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        }

        expect(init?.method).toBe('POST')
        return new Response(JSON.stringify({
          id: 'chatcmpl-test',
          object: 'chat.completion',
          model: 'old-model',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'ok' },
              finish_reason: 'stop',
            },
          ],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }) as typeof fetch

      try {
        const svc = new ProviderService()
        const provider = await svc.addProvider(sampleInput({
          providerId: 'custom',
          apiFormat: 'openai_chat',
          baseUrl: 'https://api.example.com/v1',
          modelRoles: {
            primary: 'old-model',
            fast: 'old-model',
            balanced: 'old-model',
            powerful: 'old-model',
          },
        }))

        const result = await svc.testProvider(provider.providerId)
        const updated = await svc.getProvider(provider.providerId)

        expect(result.availableModels).toEqual([
          { id: 'deepseek-chat', label: 'DeepSeek Chat', contextWindow: 128000 },
          { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner', contextWindow: 128000 },
        ])
        expect(updated.enabledModels).toEqual(['deepseek-chat', 'deepseek-reasoner'])
        expect(updated.modelRoles).toEqual({
          primary: 'deepseek-chat',
          fast: 'deepseek-chat',
          balanced: 'deepseek-chat',
          powerful: 'deepseek-chat',
        })
        expect(updated.modelContextWindows).toEqual({
          'deepseek-chat': 128000,
          'deepseek-reasoner': 128000,
        })
      } finally {
        globalThis.fetch = originalFetch
      }
    })
  })

  describe('testProviderConfig', () => {
    test('should use auth strategy headers for Anthropic-compatible tests', async () => {
      const originalFetch = globalThis.fetch
      const calls: Array<{ url: string; headers: Record<string, string> }> = []
      globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
        calls.push({
          url: String(url),
          headers: init?.headers as Record<string, string>,
        })
        return new Response(JSON.stringify({
          type: 'message',
          model: 'model-main',
          content: [],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }) as typeof fetch

      try {
        const svc = new ProviderService()
        await svc.testProviderConfig({
          baseUrl: 'https://api.example.com/anthropic',
          apiKey: 'sk-bearer',
          modelId: 'model-main',
          authStrategy: 'auth_token',
          apiFormat: 'anthropic',
        })
        await svc.testProviderConfig({
          baseUrl: 'https://api.example.com/anthropic',
          apiKey: 'sk-api',
          modelId: 'model-main',
          authStrategy: 'api_key',
          apiFormat: 'anthropic',
        })
        await svc.testProviderConfig({
          baseUrl: 'https://api.example.com/anthropic',
          apiKey: 'sk-dual',
          modelId: 'model-main',
          authStrategy: 'dual_same_token',
          apiFormat: 'anthropic',
        })

        expect(calls[0].headers.Authorization).toBe('Bearer sk-bearer')
        expect(calls[0].headers['x-api-key']).toBeUndefined()
        expect(calls[1].headers['x-api-key']).toBe('sk-api')
        expect(calls[1].headers.Authorization).toBeUndefined()
        expect(calls[2].headers['x-api-key']).toBe('sk-dual')
        expect(calls[2].headers.Authorization).toBe('Bearer sk-dual')
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    test('should use configured network timeout for provider tests', async () => {
      await fs.writeFile(
        path.join(tmpDir, 'settings.json'),
        JSON.stringify({
          network: {
            aiRequestTimeoutMs: 180_000,
            proxy: { mode: 'system', url: '' },
          },
        }),
        'utf-8',
      )
      const originalFetch = globalThis.fetch
      const originalTimeout = AbortSignal.timeout
      const timeoutCalls: number[] = []
      globalThis.fetch = mock(async (_url: string | URL | Request, _init?: RequestInit) => {
        return new Response(JSON.stringify({
          type: 'message',
          model: 'model-main',
          content: [],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }) as typeof fetch
      AbortSignal.timeout = ((ms: number) => {
        timeoutCalls.push(ms)
        return originalTimeout(ms)
      }) as typeof AbortSignal.timeout

      try {
        const svc = new ProviderService()
        await svc.testProviderConfig({
          baseUrl: 'https://api.example.com/anthropic',
          apiKey: 'sk-api',
          modelId: 'model-main',
          authStrategy: 'api_key',
          apiFormat: 'anthropic',
        })

        expect(timeoutCalls).toEqual([180_000])
      } finally {
        AbortSignal.timeout = originalTimeout
        globalThis.fetch = originalFetch
      }
    })
  })
})

// =============================================================================
// Providers REST API
// =============================================================================

describe('Providers API', () => {
  beforeEach(setup)
  afterEach(teardown)

  // ─── GET /api/providers ──────────────────────────────────────────────────

  test('GET /api/providers should return empty list initially', async () => {
    const { req, url, segments } = makeRequest('GET', '/api/providers')
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(200)
    const body = (await res.json()) as { providers: unknown[] }
    expect(body.providers).toEqual([])
  })

  test('GET /api/providers should list added providers', async () => {
    // Seed a provider via service
    const svc = new ProviderService()
    await svc.addProvider(sampleInput())

    const { req, url, segments } = makeRequest('GET', '/api/providers')
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(200)
    const body = (await res.json()) as { providers: { displayName: string; apiKey: string }[] }
    expect(body.providers).toHaveLength(1)
    expect(body.providers[0].displayName).toBe('Test Provider')
    expect(body.providers[0].apiKey).toBe('***REDACTED***')
    expect(JSON.stringify(body)).not.toContain('sk-test-key-123')
  })

  test('POST /api/providers/rescan should refresh saved provider model candidates', async () => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      expect(String(url)).toBe('https://api.example.com/v1/models')
      return new Response(JSON.stringify({
        data: [
          { id: 'scan-model-a', display_name: 'Scan Model A' },
          { id: 'scan-model-b', display_name: 'Scan Model B' },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch

    try {
      const svc = new ProviderService()
      await svc.addProvider(sampleInput({
        apiFormat: 'openai_chat',
        baseUrl: 'https://api.example.com/v1',
      }))

      const { req, url, segments } = makeRequest('POST', '/api/providers/rescan')
      const res = await handleProvidersApi(req, url, segments)

      expect(res.status).toBe(200)
      const body = (await res.json()) as { providers: Array<{ enabledModels: string[]; apiKey: string }> }
      expect(body.providers[0].enabledModels).toEqual(['scan-model-a', 'scan-model-b'])
      expect(body.providers[0].apiKey).toBe('***REDACTED***')
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  // ─── POST /api/providers ─────────────────────────────────────────────────

  test('POST /api/providers should create a provider', async () => {
    const { req, url, segments } = makeRequest('POST', '/api/providers', {
      providerId: 'custom',
      displayName: 'New Provider',
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      apiFormat: 'anthropic',
      autoCompactWindow: 64000,
      modelRoles: {
        primary: 'gpt-4',
        fast: 'gpt-4-fast',
        balanced: 'gpt-4-balanced',
        powerful: 'gpt-4-powerful',
      },
    })
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      provider: {
        displayName: string
        modelRoles: { primary: string }
        models: { main: string }
        autoCompactWindow: number
      }
    }
    expect(body.provider.displayName).toBe('New Provider')
    expect(body.provider.modelRoles.primary).toBe('gpt-4')
    expect(body.provider.modelRoles.primary).toBe('gpt-4')
    expect(body.provider.autoCompactWindow).toBe(64000)
  })

  test('POST /api/providers should return 400 for invalid input', async () => {
    const { req, url, segments } = makeRequest('POST', '/api/providers', {
      displayName: '', // invalid: empty name
    })
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(400)
  })

  test('POST /api/providers should return 400 for invalid auto compact window', async () => {
    const { req, url, segments } = makeRequest('POST', '/api/providers', {
      providerId: 'custom',
      displayName: 'New Provider',
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      apiFormat: 'anthropic',
      autoCompactWindow: 8000,
      modelRoles: {
        primary: 'gpt-4',
        fast: 'gpt-4-fast',
        balanced: 'gpt-4-balanced',
        powerful: 'gpt-4-powerful',
      },
    })
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(400)
  })

  // ─── GET /api/providers/:id ──────────────────────────────────────────────

  test('GET /api/providers/:id should return a provider', async () => {
    const svc = new ProviderService()
    const added = await svc.addProvider(sampleInput())

    const { req, url, segments } = makeRequest('GET', `/api/providers/${added.providerId}`)
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(200)
    const body = (await res.json()) as { provider: { id: string; displayName: string } }
    expect(body.provider.providerId).toBe(added.providerId)
  })

  test('GET /api/providers/:id should return 404 for unknown id', async () => {
    const { req, url, segments } = makeRequest('GET', '/api/providers/unknown-id')
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(404)
  })

  // ─── PUT /api/providers/:id ──────────────────────────────────────────────

  test('PUT /api/providers/:id should update a provider', async () => {
    const svc = new ProviderService()
    const added = await svc.addProvider(sampleInput())

    const { req, url, segments } = makeRequest('PUT', `/api/providers/${added.providerId}`, {
      displayName: 'Renamed Provider',
    })
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(200)
    const body = (await res.json()) as { provider: { displayName: string } }
    expect(body.provider.displayName).toBe('Renamed Provider')
  })

  // ─── DELETE /api/providers/:id ───────────────────────────────────────────

  test('DELETE /api/providers/:id should delete an inactive provider', async () => {
    const svc = new ProviderService()
    await svc.addProvider(sampleInput({ displayName: 'First' }))
    const second = await svc.addProvider(sampleInput({ displayName: 'Second' }))

    const { req, url, segments } = makeRequest('DELETE', `/api/providers/${second.providerId}`)
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  test('DELETE /api/providers/:id should delete an active provider', async () => {
    const svc = new ProviderService()
    const active = await svc.addProvider(sampleInput())
    await svc.activateProvider(active.providerId)

    const { req, url, segments } = makeRequest('DELETE', `/api/providers/${active.providerId}`)
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)
    const { activeId, providers } = await svc.listProviders()
    expect(activeId).toBe(null)
    expect(providers).toHaveLength(0)
  })

  // ─── POST /api/providers/:id/activate ────────────────────────────────────

  test('POST /api/providers/:id/activate should activate a provider', async () => {
    const svc = new ProviderService()
    await svc.addProvider(sampleInput({ displayName: 'First' }))
    const second = await svc.addProvider(
      sampleInput({
        displayName: 'Second',
        baseUrl: 'https://second.example.com',
        apiKey: 'sk-second',
      }),
    )

    const { req, url, segments } = makeRequest(
      'POST',
      `/api/providers/${second.providerId}/activate`,
    )
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean }
    expect(body.ok).toBe(true)

    // Verify settings were synced
    const settings = await readSettings()
    const env = settings.env as Record<string, string>
    expect(env.ANTHROPIC_BASE_URL).toBe('https://second.example.com')
    expect(env.ANTHROPIC_API_KEY).toBe('sk-second')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(env.ANTHROPIC_MODEL).toBe('model-primary')
  })

  test('POST /api/providers/:id/activate should not require modelId', async () => {
    const svc = new ProviderService()
    const provider = await svc.addProvider(sampleInput())

    const { req, url, segments } = makeRequest(
      'POST',
      `/api/providers/${provider.providerId}/activate`,
      {},
    )
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(200)
  })

  test('POST /api/providers/:id/activate should ignore modelId because session runtime selects the model', async () => {
    const svc = new ProviderService()
    const provider = await svc.addProvider(sampleInput())

    const { req, url, segments } = makeRequest(
      'POST',
      `/api/providers/${provider.providerId}/activate`,
      { modelId: 'non-existent-model' },
    )
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(200)
  })

  // ─── Method not allowed ──────────────────────────────────────────────────

  test('should return 405 for unsupported methods', async () => {
    const { req, url, segments } = makeRequest('PATCH', '/api/providers')
    const res = await handleProvidersApi(req, url, segments)

    expect(res.status).toBe(405)
  })
})
