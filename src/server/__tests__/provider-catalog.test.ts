import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'

import { handleProvidersApi } from '../api/providers.js'
import { PROVIDER_CATALOG, ProviderCatalogSchema } from '../config/providerCatalog.js'

let tmpDir: string
let originalConfigDir: string | undefined

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-catalog-test-'))
  originalConfigDir = process.env.BEYA_CONFIG_DIR
  process.env.BEYA_CONFIG_DIR = tmpDir
})

afterEach(async () => {
  if (originalConfigDir !== undefined) {
    process.env.BEYA_CONFIG_DIR = originalConfigDir
  } else {
    delete process.env.BEYA_CONFIG_DIR
  }
  await fs.rm(tmpDir, { recursive: true, force: true })
})

function makeRequest(method: string, urlStr: string): { req: Request; url: URL; segments: string[] } {
  const url = new URL(urlStr, 'http://localhost:3456')
  const req = new Request(url.toString(), { method })
  const segments = url.pathname.split('/').filter(Boolean)
  return { req, url, segments }
}

describe('provider catalog API', () => {
  test('GET /api/providers/catalog returns the configured provider catalog', async () => {
    const { req, url, segments } = makeRequest('GET', '/api/providers/catalog')
    const response = await handleProvidersApi(req, url, segments)

    expect(response.status).toBe(200)
    const body = await response.json() as { catalog: typeof PROVIDER_CATALOG }
    expect(body.catalog).toEqual(PROVIDER_CATALOG)
    expect(ProviderCatalogSchema.parse(body.catalog)).toEqual(PROVIDER_CATALOG)
  })

  test('legacy presets endpoint is removed', async () => {
    const { req, url, segments } = makeRequest('GET', '/api/providers/presets')
    const response = await handleProvidersApi(req, url, segments)

    expect(response.status).toBe(404)
  })

  test('catalog includes the supported provider set without ad router presets', () => {
    const providerIds = PROVIDER_CATALOG.providers.map((provider) => provider.providerId)

    expect(providerIds).toEqual([
      'openai',
      'anthropic',
      'deepseek',
      'qwen',
      'zai',
      'kimi',
      'minimax',
      'google',
      'xai',
      'groq',
      'meta',
      'ollama',
      'lmstudio',
      'custom',
    ])
    expect(providerIds).not.toContain('jiekouai')
    expect(providerIds).not.toContain('shengsuanyun')
    expect(providerIds).not.toContain('zhipuglm')
  })

  test('providers expose model roles, model metadata, tiers, and context windows', () => {
    for (const provider of PROVIDER_CATALOG.providers) {
      expect(provider.providerId).toBeTruthy()
      expect(provider.displayName).toBeTruthy()
      expect(provider.defaultModelRoles).toEqual({
        primary: expect.any(String),
        fast: expect.any(String),
        balanced: expect.any(String),
        powerful: expect.any(String),
      })
      expect(provider).not.toHaveProperty('defaultModels')
      expect(provider).not.toHaveProperty('promoText')
      expect(provider).not.toHaveProperty('featured')

      if (provider.providerId !== 'custom') {
        expect(provider.models.length).toBeGreaterThan(0)
        for (const model of provider.models) {
          expect(model.providerId).toBe(provider.providerId)
          expect(model.contextWindow).toBeGreaterThanOrEqual(16000)
          expect(['small', 'medium', 'large']).toContain(model.tier)
          expect(model.capabilities.length).toBeGreaterThan(0)
        }
      }
    }

    const tierEntries = Object.values(PROVIDER_CATALOG.modelTiers).flat()
    expect(tierEntries.length).toBeGreaterThan(0)
    for (const entry of tierEntries) {
      const provider = PROVIDER_CATALOG.providers.find(item => item.providerId === entry.providerId)
      expect(provider?.models.some(model => model.id === entry.modelId)).toBe(true)
    }
  })

  test('Shannon-style OpenAI-compatible endpoints are represented in the catalog', () => {
    const byId = new Map(PROVIDER_CATALOG.providers.map((provider) => [provider.providerId, provider]))

    expect(byId.get('openai')?.apiFormat).toBe('openai_responses')
    expect(byId.get('deepseek')?.baseUrl).toBe('https://api.deepseek.com/v1')
    expect(byId.get('qwen')?.baseUrl).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1')
    expect(byId.get('zai')?.baseUrl).toBe('https://api.z.ai/api/paas/v4')
    expect(byId.get('google')?.baseUrl).toBe('https://generativelanguage.googleapis.com/v1beta/openai')
    expect(byId.get('ollama')?.needsApiKey).toBe(false)
    expect(byId.get('lmstudio')?.needsApiKey).toBe(false)
  })

  test('GET and PUT /api/providers/settings read and write beya settings.json', async () => {
    const initial = {
      env: {
        ANTHROPIC_MODEL: 'glm-5',
      },
      model: 'glm-5',
    }
    await fs.mkdir(path.join(tmpDir, 'beya'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'beya', 'settings.json'),
      JSON.stringify(initial, null, 2),
      'utf-8',
    )

    const getReq = makeRequest('GET', '/api/providers/settings')
    const getRes = await handleProvidersApi(getReq.req, getReq.url, getReq.segments)
    expect(getRes.status).toBe(200)
    expect(await getRes.json()).toEqual(initial)

    const updateBody = {
      model: 'kimi-k2.6',
      env: {
        ANTHROPIC_MODEL: 'kimi-k2.6',
      },
    }
    const putReq = new Request('http://localhost:3456/api/providers/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updateBody),
    })
    const putRes = await handleProvidersApi(
      putReq,
      new URL(putReq.url),
      ['api', 'providers', 'settings'],
    )
    expect(putRes.status).toBe(200)

    const updatedRaw = await fs.readFile(path.join(tmpDir, 'beya', 'settings.json'), 'utf-8')
    expect(JSON.parse(updatedRaw)).toEqual(updateBody)
  })
})
