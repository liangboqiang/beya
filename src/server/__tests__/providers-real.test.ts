/**
 * 用真实的 Provider 配置测试 ProviderService
 * 验证添加、激活、beya/settings.json 同步是否正确
 * (provider env 写到 ~/.beya/beya/settings.json，不污染原版 settings.json)
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { ProviderService } from '../services/providerService.js'

const MODEL_ROLES = {
  primary: 'MiniMax-M2.7-highspeed',
  fast: 'MiniMax-M2.7-highspeed',
  balanced: 'MiniMax-M2.7-highspeed',
  powerful: 'MiniMax-M2.7-highspeed',
}

describe('Real Provider Configs', () => {
  let tmpDir: string
  let service: ProviderService

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'provider-real-'))
    process.env.BEYA_CONFIG_DIR = tmpDir
    service = new ProviderService()
  })

  afterEach(async () => {
    delete process.env.BEYA_CONFIG_DIR
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  // Helper: read the Beya-specific settings file
  async function readBeyaSettings(): Promise<Record<string, unknown>> {
    const raw = await fs.readFile(path.join(tmpDir, 'beya', 'settings.json'), 'utf-8')
    return JSON.parse(raw)
  }

  // Helper: check original settings.json is NOT modified
  async function originalSettingsExists(): Promise<boolean> {
    try {
      await fs.access(path.join(tmpDir, 'settings.json'))
      return true
    } catch {
      return false
    }
  }

  test('添加 MiniMax Provider 并激活 — 写入 beya/settings.json', async () => {
    const minimax = await service.addProvider({
      presetId: 'minimax',
      name: 'MiniMax',
      baseUrl: 'https://api.minimaxi.com/anthropic',
      apiKey: 'sk-fake-test-key-for-testing-only',
      modelRoles: MODEL_ROLES,
      notes: 'MiniMax 官方 Anthropic 兼容接口',
    })

    expect(minimax.name).toBe('MiniMax')

    // 激活 provider
    await service.activateProvider(minimax.id)

    // 验证写入 beya/settings.json
    const settings = await readBeyaSettings()
    expect((settings.env as Record<string, string>).ANTHROPIC_BASE_URL).toBe('https://api.minimaxi.com/anthropic')
    expect((settings.env as Record<string, string>).ANTHROPIC_AUTH_TOKEN).toBe('sk-fake-test-key-for-testing-only')
    expect((settings.env as Record<string, string>).ANTHROPIC_API_KEY).toBe('')
    expect((settings.env as Record<string, string>).ANTHROPIC_MODEL).toBe('MiniMax-M2.7-highspeed')
    expect(JSON.parse((settings.env as Record<string, string>).CLAUDE_CODE_MODEL_CONTEXT_WINDOWS)).toMatchObject({
      'MiniMax-M2.7': 204800,
      'MiniMax-M2.7-highspeed': 204800,
    })

    // 验证原版 settings.json 没有被创建
    expect(await originalSettingsExists()).toBe(false)

    console.log('✅ Provider 写入 beya/settings.json，原版 settings.json 未被污染')
  })

  test('切换 Provider — 更新 beya/settings.json', async () => {
    const minimax = await service.addProvider({
      presetId: 'minimax',
      name: 'MiniMax',
      baseUrl: 'https://api.minimaxi.com/anthropic',
      apiKey: 'sk-api-test-minimax',
      modelRoles: MODEL_ROLES,
    })

    const jiekou = await service.addProvider({
      presetId: 'custom',
      name: '接口AI中转站',
      baseUrl: 'https://api.jiekou.ai/anthropic',
      apiKey: 'sk-fake-test-key-for-testing-only',
      modelRoles: {
        primary: 'claude-opus-4-7',
        fast: 'claude-haiku-4-5',
        balanced: 'claude-sonnet-4-6',
        powerful: 'claude-opus-4-7',
      },
    })

    // 先激活 MiniMax
    await service.activateProvider(minimax.id)
    let settings = await readBeyaSettings()
    expect((settings.env as Record<string, string>).ANTHROPIC_BASE_URL).toBe('https://api.minimaxi.com/anthropic')
    expect(JSON.parse((settings.env as Record<string, string>).CLAUDE_CODE_MODEL_CONTEXT_WINDOWS)).toMatchObject({
      'MiniMax-M2.7': 204800,
      'MiniMax-M2.7-highspeed': 204800,
    })

    // 切换到接口AI中转站
    await service.activateProvider(jiekou.id)
    settings = await readBeyaSettings()
    expect((settings.env as Record<string, string>).ANTHROPIC_BASE_URL).toBe('https://api.jiekou.ai/anthropic')
    expect((settings.env as Record<string, string>).ANTHROPIC_AUTH_TOKEN).toBe('sk-fake-test-key-for-testing-only')
    expect((settings.env as Record<string, string>).ANTHROPIC_API_KEY).toBe('')
    expect((settings.env as Record<string, string>).ANTHROPIC_MODEL).toBe('claude-opus-4-7')
    expect((settings.env as Record<string, string>).CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBeUndefined()

    // 验证 activeId 正确
    const list = await service.listProviders()
    expect(list.activeId).toBe(jiekou.id)

    // 原版 settings.json 依然不存在
    expect(await originalSettingsExists()).toBe(false)

    console.log('✅ 切换 Provider 成功，beya/settings.json 更新正确')
  })

  test('beya/settings.json 保留已有字段', async () => {
    // 预写一个有内容的 beya/settings.json（模拟用户已有配置）
    await fs.mkdir(path.join(tmpDir, 'beya'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'beya', 'settings.json'),
      JSON.stringify({
        customField: 'should_be_preserved',
        env: {
          EXISTING_VAR: 'should_be_preserved',
        },
      }, null, 2),
    )

    // 添加并激活 provider
    const provider = await service.addProvider({
      presetId: 'custom',
      name: '接口AI中转站',
      baseUrl: 'https://api.jiekou.ai/anthropic',
      apiKey: 'sk_test',
      modelRoles: {
        primary: 'claude-opus-4-7',
        fast: 'claude-haiku-4-5',
        balanced: 'claude-sonnet-4-6',
        powerful: 'claude-opus-4-7',
      },
    })
    await service.activateProvider(provider.id)

    const settings = await readBeyaSettings()

    // 验证新字段写入
    expect((settings.env as Record<string, string>).ANTHROPIC_BASE_URL).toBe('https://api.jiekou.ai/anthropic')
    expect((settings.env as Record<string, string>).ANTHROPIC_AUTH_TOKEN).toBe('sk_test')
    expect((settings.env as Record<string, string>).ANTHROPIC_API_KEY).toBe('')

    // 验证已有字段保留
    expect(settings.customField).toBe('should_be_preserved')
    expect((settings.env as Record<string, string>).EXISTING_VAR).toBe('should_be_preserved')

    console.log('✅ beya/settings.json 已有字段全部保留')
  })

  test('deactivateProvider 清除 provider env', async () => {
    const provider = await service.addProvider({
      presetId: 'minimax',
      name: 'MiniMax',
      baseUrl: 'https://api.minimaxi.com/anthropic',
      apiKey: 'sk-test',
      modelRoles: MODEL_ROLES,
    })

    await service.activateProvider(provider.id)

    // 确认写入了
    let settings = await readBeyaSettings()
    expect((settings.env as Record<string, string>).ANTHROPIC_BASE_URL).toBeDefined()

    // 取消 active provider
    await service.deactivateProvider()

    settings = await readBeyaSettings()
    const env = settings.env as Record<string, string> | undefined
    expect(env?.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(env?.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env?.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(env?.ANTHROPIC_MODEL).toBeUndefined()

    console.log('✅ deactivateProvider 正确清除了 provider env')
  })

  test('连通性测试 — 返回结构正确', async () => {
    const result = await service.testProviderConfig({
      baseUrl: 'https://api.minimaxi.com/anthropic',
      apiKey: 'sk-fake-test-key',
      modelId: 'MiniMax-M2.7-highspeed',
      authStrategy: 'auth_token',
    })

    // testProviderConfig 返回 { connectivity: { ... }, proxy?: { ... } }
    expect(result.connectivity).toBeDefined()
    expect(result.connectivity.latencyMs).toBeGreaterThanOrEqual(0)
    expect(result.connectivity.modelUsed).toBe('MiniMax-M2.7-highspeed')

    console.log('🔌 MiniMax 连通性测试结果:')
    console.log('   success:', result.connectivity.success)
    console.log('   latencyMs:', result.connectivity.latencyMs)
    console.log('   error:', result.connectivity.error)
  })

  test('providers.json 和 beya/settings.json 独立于 settings.json', async () => {
    // 模拟原版 Beya 的 settings.json 已存在
    await fs.writeFile(
      path.join(tmpDir, 'settings.json'),
      JSON.stringify({
        effortLevel: 'high',
        env: {
          ANTHROPIC_BASE_URL: 'https://original-beya.api.com',
          ANTHROPIC_API_KEY: 'original-key',
        },
      }, null, 2),
    )

    // Beya 添加并激活自己的 provider
    const provider = await service.addProvider({
      presetId: 'minimax',
      name: 'MiniMax',
      baseUrl: 'https://api.minimaxi.com/anthropic',
      apiKey: 'sk-beya-key',
      modelRoles: MODEL_ROLES,
    })
    await service.activateProvider(provider.id)

    // 验证原版 settings.json 没被修改
    const original = JSON.parse(await fs.readFile(path.join(tmpDir, 'settings.json'), 'utf-8'))
    expect((original.env as Record<string, string>).ANTHROPIC_BASE_URL).toBe('https://original-beya.api.com')
    expect((original.env as Record<string, string>).ANTHROPIC_API_KEY).toBe('original-key')
    expect(original.effortLevel).toBe('high')

    // 验证 beya/settings.json 是 Beya 自己的
    const beya = await readBeyaSettings()
    expect((beya.env as Record<string, string>).ANTHROPIC_BASE_URL).toBe('https://api.minimaxi.com/anthropic')
    expect((beya.env as Record<string, string>).ANTHROPIC_AUTH_TOKEN).toBe('sk-beya-key')
    expect((beya.env as Record<string, string>).ANTHROPIC_API_KEY).toBe('')

    console.log('✅ 原版 settings.json 完好无损，Beya 配置独立存储')
  })
})
