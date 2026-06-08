import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { ProviderService } from '../services/providerService.js'
import { deriveTitle, generateTitle, parseGeneratedTitleText, saveAiTitle } from '../services/titleService.js'
import { sessionService } from '../services/sessionService.js'

describe('titleService', () => {
  let tmpDir: string
  let originalConfigDir: string | undefined
  let originalFetch: typeof globalThis.fetch

  beforeEach(async () => {
    originalConfigDir = process.env.BEYA_CONFIG_DIR
    originalFetch = globalThis.fetch
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'title-service-test-'))
    process.env.BEYA_CONFIG_DIR = tmpDir
  })

  afterEach(async () => {
    globalThis.fetch = originalFetch
    restoreEnv('BEYA_CONFIG_DIR', originalConfigDir)
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('sends disabled thinking for opted-in providers when desktop thinking is off', async () => {
    let requestBody: Record<string, unknown> | null = null
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(req) {
        requestBody = await req.json() as Record<string, unknown>
        return Response.json({
          content: [{ type: 'text', text: '{"title":"Trace ok"}' }],
        })
      },
    })

    try {
      const providerId = 'zai'
      await fs.mkdir(path.join(tmpDir, 'beya'), { recursive: true })
      await fs.writeFile(
        path.join(tmpDir, 'settings.json'),
        JSON.stringify({ alwaysThinkingEnabled: false }, null, 2),
      )
      await fs.writeFile(
        path.join(tmpDir, 'beya', 'providers.json'),
        JSON.stringify({
          activeId: providerId,
          providers: [
            {
              providerId,
              displayName: 'Z.AI',
              apiKey: 'test-key',
              baseUrl: `http://127.0.0.1:${server.port}/anthropic`,
              apiFormat: 'anthropic',
              modelRoles: {
                primary: 'glm-5',
                fast: 'glm-4.7-flash',
                balanced: 'glm-4.7',
                powerful: 'glm-5',
              },
            },
          ],
        }, null, 2),
      )

      await expect(generateTitle('trace-ok')).resolves.toBe('Trace ok')
      expect(requestBody?.thinking).toEqual({ type: 'disabled' })
      expect(requestBody?.model).toBe('glm-4.7-flash')
    } finally {
      server.stop(true)
    }
  })

  test('sends disabled thinking for DeepSeek title generation when desktop thinking is off', async () => {
    let requestBody: Record<string, unknown> | null = null
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(req) {
        requestBody = await req.json() as Record<string, unknown>
        return Response.json({
          content: [{ type: 'text', text: '{"title":"Trace ok"}' }],
        })
      },
    })

    try {
      const providerId = 'deepseek'
      await fs.mkdir(path.join(tmpDir, 'beya'), { recursive: true })
      await fs.writeFile(
        path.join(tmpDir, 'settings.json'),
        JSON.stringify({ alwaysThinkingEnabled: false }, null, 2),
      )
      await fs.writeFile(
        path.join(tmpDir, 'beya', 'providers.json'),
        JSON.stringify({
          activeId: providerId,
          providers: [
            {
              providerId,
              displayName: 'DeepSeek',
              apiKey: 'test-key',
              baseUrl: `http://127.0.0.1:${server.port}/anthropic`,
              apiFormat: 'anthropic',
              modelRoles: {
                primary: 'deepseek-v4-pro',
                fast: 'deepseek-v4-pro',
                balanced: 'deepseek-v4-pro',
                powerful: 'deepseek-v4-pro',
              },
            },
          ],
        }, null, 2),
      )

      await expect(generateTitle('trace-ok')).resolves.toBe('Trace ok')
      expect(requestBody?.thinking).toEqual({ type: 'disabled' })
      expect(requestBody?.model).toBe('deepseek-v4-pro')
    } finally {
      server.stop(true)
    }
  })

  test('derives slash-command titles from command metadata without raw XML tags', () => {
    const raw = [
      '<command-message>frontend-design</command-message>',
      '<command-name>/frontend-design</command-name>',
      '<command-args>@website 閲嶆柊璁捐棣栭〉</command-args>',
    ].join('\n')

    expect(deriveTitle(raw)).toBe('/frontend-design @website 閲嶆柊璁捐棣栭〉')
  })

  test('sends cleaned slash-command text to the title model', async () => {
    let requestBody: {
      messages?: Array<{ content?: string }>
    } | null = null
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(req) {
        requestBody = await req.json() as {
          messages?: Array<{ content?: string }>
        }
        return Response.json({
          content: [{ type: 'text', text: '{"title":"Redesign website"}' }],
        })
      },
    })

    try {
      const providerId = 'anthropic'
      await fs.mkdir(path.join(tmpDir, 'beya'), { recursive: true })
      await fs.writeFile(
        path.join(tmpDir, 'beya', 'providers.json'),
        JSON.stringify({
          activeId: providerId,
          providers: [
            {
              providerId,
              displayName: 'Anthropic',
              apiKey: 'test-key',
              baseUrl: `http://127.0.0.1:${server.port}/anthropic`,
              apiFormat: 'anthropic',
              modelRoles: {
                primary: 'title-primary',
                fast: 'title-fast',
                balanced: 'title-balanced',
                powerful: 'title-powerful',
              },
            },
          ],
        }, null, 2),
      )

      await expect(generateTitle([
        '<command-message>frontend-design</command-message>',
        '<command-name>/frontend-design</command-name>',
        '<command-args>@website 閲嶆柊璁捐棣栭〉</command-args>',
      ].join('\n'))).resolves.toBe('Redesign website')

      expect(requestBody?.messages?.[0]?.content).toBe('/frontend-design @website 閲嶆柊璁捐棣栭〉')
      expect(requestBody?.model).toBe('title-fast')
    } finally {
      server.stop(true)
    }
  })

  test('does not generate titles from a stale removed ChatGPT Official active id', async () => {
    await fs.mkdir(path.join(tmpDir, 'beya'), { recursive: true })
    await fs.writeFile(
      path.join(tmpDir, 'beya', 'providers.json'),
      JSON.stringify({ activeId: 'openai-official', providers: [] }),
      'utf-8',
    )
    let fetched = false
    globalThis.fetch = (async () => {
      fetched = true
      return new Response('{}')
    }) as typeof fetch

    await expect(generateTitle('trace-ok')).resolves.toBeNull()
    expect(fetched).toBe(false)
  })

  test('parses JSON title responses wrapped in markdown fences', () => {
    expect(parseGeneratedTitleText('```json\n{"title":"Write bash script"}\n```'))
      .toBe('Write bash script')
  })

  test('parses escaped JSON title responses', () => {
    expect(parseGeneratedTitleText('```json\n{\\"title\\":\\"Write bash script\\"}\n```'))
      .toBe('Write bash script')
  })

  test('rejects incomplete JSON title fragments instead of using them as titles', () => {
    expect(parseGeneratedTitleText('```json\n{\\"title\\":')).toBeNull()
  })

  test('normalizes XML-like title model output before persisting it', () => {
    expect(parseGeneratedTitleText([
      '<command-message>frontend-design</command-message>',
      '<command-name>/frontend-design</command-name>',
      '<command-args>@website</command-args>',
    ].join(' '))).toBe('/frontend-design @website')
  })

  test('does not persist automatic titles over a user custom title', async () => {
    const { sessionId } = await sessionService.createSession(os.tmpdir())
    await sessionService.renameSession(sessionId, 'My fixed name')

    await expect(saveAiTitle(sessionId, 'Automatic topic')).resolves.toBe(false)

    const detail = await sessionService.getSession(sessionId)
    expect(detail?.title).toBe('My fixed name')

    const found = await sessionService.findSessionFile(sessionId)
    expect(found).not.toBeNull()
    const content = await fs.readFile(found!.filePath, 'utf-8')
    expect(content).not.toContain('"type":"ai-title"')
  })
})

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key]
  } else {
    process.env[key] = value
  }
}
