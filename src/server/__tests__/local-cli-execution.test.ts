import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { getLocalCliAdapter } from '../local-cli/adapters.js'
import { localCliProxy } from '../local-cli/localCliProxy.js'
import type { SelectedLocalCliRuntime } from '../services/localCliRuntimeService.js'

describe('Local CLI execution backend', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'beya-local-cli-exec-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  test('codex adapter builds a one-shot JSON invocation and extracts assistant text', () => {
    const adapter = getLocalCliAdapter('codex')
    const invocation = adapter.buildInvocation({
      runtime: makeRuntime('codex', 'Codex CLI', '/tmp/codex'),
      workDir: '/repo',
      model: 'gpt-5-codex',
      content: 'hello',
    })

    expect(invocation.stdin).toBe('hello')
    expect(invocation.args).toContain('exec')
    expect(invocation.args).toContain('--json')
    expect(invocation.args).toContain('--model')
    expect(invocation.args).toContain('gpt-5-codex')
    expect(invocation.args).toContain('-C')
    expect(invocation.args).toContain('/repo')
    expect(adapter.extractAssistantText(
      '{"type":"item.completed","item":{"type":"assistant_message","text":"done"}}\n',
    )).toBe('done')
  })

  test('claude adapter uses stream-json and extracts assistant text blocks', () => {
    const adapter = getLocalCliAdapter('claude')
    const invocation = adapter.buildInvocation({
      runtime: makeRuntime('claude', 'Claude Code', '/tmp/claude'),
      workDir: '/repo',
      model: 'sonnet',
      content: 'hello',
    })

    expect(invocation.args).toEqual([
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--model',
      'sonnet',
    ])
    expect(JSON.parse(invocation.stdin)).toEqual({
      type: 'user',
      message: {
        role: 'user',
        content: 'hello',
      },
    })
    expect(adapter.extractAssistantText(
      '{"type":"assistant","message":{"content":[{"type":"text","text":"hello"},{"type":"text","text":" world"}]}}\n',
    )).toBe('hello\n world')
  })

  test('proxy maps a selected local CLI process into normalized desktop events', async () => {
    const cliPath = await writeExecutableCli('codex', [
      '{"type":"item.completed","item":{"type":"assistant_message","text":"proxy handled turn"}}',
    ])
    const events: Record<string, unknown>[] = []
    const captured: string[] = []
    const turn = localCliProxy.startTurn({
      sessionId: 'session-1',
      runtime: makeRuntime('codex', 'Codex CLI', cliPath),
      workDir: tmpDir,
      model: 'default',
      content: 'prompt',
      baseEnv: { PATH: process.env.PATH ?? '' },
      redactOutput: (text) => text,
      onCapturedLine: (stream, line) => captured.push(`${stream}:${line}`),
      onEvent: (event) => events.push(event),
    })

    await turn.done

    expect(events).toContainEqual(expect.objectContaining({
      type: 'assistant',
      message: expect.objectContaining({
        content: [{ type: 'text', text: 'proxy handled turn' }],
      }),
    }))
    expect(events).toContainEqual(expect.objectContaining({
      type: 'result',
      subtype: 'success',
      is_error: false,
      usage: {
        status: 'unavailable',
        source: 'local_cli',
      },
    }))
    expect(captured.some((line) => line.includes('proxy handled turn'))).toBe(true)
  })

  test('proxy owns local CLI process metadata and runtime env injection', async () => {
    const cliPath = await writeEnvironmentEchoCli('codex-env')
    const events: Record<string, unknown>[] = []
    const turn = localCliProxy.startTurn({
      sessionId: 'session-env',
      runtime: {
        ...makeRuntime('codex', 'Codex CLI', cliPath),
        autoCompactWindow: 12345,
        env: {
          BEYA_LOCAL_CLI_ID: 'user-override-must-not-win',
          TEST_LOCAL_CLI_ENV: 'runtime-env',
        },
      },
      workDir: tmpDir,
      model: 'default',
      content: 'prompt',
      baseEnv: { PATH: process.env.PATH ?? '' },
      redactOutput: (text) => text,
      onCapturedLine: () => {},
      onEvent: (event) => events.push(event),
    })

    await turn.done

    expect(events).toContainEqual(expect.objectContaining({
      type: 'assistant',
      message: expect.objectContaining({
        content: [{ type: 'text', text: 'codex|runtime-env|12345' }],
      }),
    }))
  })

  function makeRuntime(
    id: string,
    displayName: string,
    launchPath: string,
  ): SelectedLocalCliRuntime {
    return {
      id,
      displayName,
      executablePath: launchPath,
      launchPath,
      childPathPrepend: [],
      env: {},
      modelRoles: {
        primary: 'default',
        fast: 'default',
        balanced: 'default',
        powerful: 'default',
      },
    }
  }

  async function writeExecutableCli(name: string, jsonLines: string[]): Promise<string> {
    const filePath = path.join(tmpDir, process.platform === 'win32' ? `${name}.cmd` : name)
    if (process.platform === 'win32') {
      await fs.writeFile(
        filePath,
        [
          '@echo off',
          ...jsonLines.map((line) => `echo ${line}`),
          '',
        ].join('\r\n'),
        'utf-8',
      )
      return filePath
    }

    await fs.writeFile(
      filePath,
      [
        '#!/bin/sh',
        'cat >/dev/null',
        ...jsonLines.map((line) => `printf '%s\\n' '${line}'`),
        '',
      ].join('\n'),
      { mode: 0o755 },
    )
    return filePath
  }

  async function writeEnvironmentEchoCli(name: string): Promise<string> {
    const filePath = path.join(tmpDir, process.platform === 'win32' ? `${name}.cmd` : name)
    if (process.platform === 'win32') {
      await fs.writeFile(
        filePath,
        [
          '@echo off',
          'echo {"type":"item.completed","item":{"type":"assistant_message","text":"%BEYA_LOCAL_CLI_ID%|%TEST_LOCAL_CLI_ENV%|%CLAUDE_CODE_AUTO_COMPACT_WINDOW%"}}',
          '',
        ].join('\r\n'),
        'utf-8',
      )
      return filePath
    }

    await fs.writeFile(
      filePath,
      [
        '#!/bin/sh',
        'cat >/dev/null',
        'printf \'%s\\n\' "{\\"type\\":\\"item.completed\\",\\"item\\":{\\"type\\":\\"assistant_message\\",\\"text\\":\\"${BEYA_LOCAL_CLI_ID}|${TEST_LOCAL_CLI_ENV}|${CLAUDE_CODE_AUTO_COMPACT_WINDOW}\\"}}"',
        '',
      ].join('\n'),
      { mode: 0o755 },
    )
    return filePath
  }
})
