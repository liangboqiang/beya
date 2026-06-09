import * as path from 'node:path'

import {
  getWellKnownUserToolchainBins,
  type SelectedLocalCliRuntime,
} from '../services/localCliRuntimeService.js'
import { getLocalCliAdapter } from './adapters.js'
import {
  collectLocalCliOutputStream,
  wrapLocalCliCommandForPlatform,
  writeLocalCliStdin,
} from './processRunner.js'
import type {
  LocalCliTurnHandle,
  LocalCliTurnInput,
} from './types.js'

export class LocalCliProxy {
  startTurn(input: LocalCliTurnInput): LocalCliTurnHandle {
    const adapter = getLocalCliAdapter(input.runtime.id)
    const invocation = adapter.buildInvocation({
      runtime: input.runtime,
      workDir: input.workDir,
      model: input.model,
      content: input.content,
    })
    const childEnv = this.buildProcessEnv(input.baseEnv, input.runtime)
    const command = wrapLocalCliCommandForPlatform(input.runtime.launchPath, invocation.args)

    const proc = Bun.spawn(command, {
      cwd: input.workDir,
      env: childEnv,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const stdoutPromise = collectLocalCliOutputStream(
      proc.stdout,
      'stdout',
      input.redactOutput,
      input.onCapturedLine,
    )
    const stderrPromise = collectLocalCliOutputStream(
      proc.stderr,
      'stderr',
      input.redactOutput,
      input.onCapturedLine,
    )
    const outputDrain = Promise.all([stdoutPromise, stderrPromise]).then(() => undefined)

    const done = (async () => {
      await writeLocalCliStdin(proc, invocation.stdin)

      const exitCode = await proc.exited
      const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise])

      if (exitCode !== 0) {
        const detail = input.redactOutput(`${stderr}\n${stdout}`.trim())
        input.onEvent({
          type: 'result',
          subtype: 'error',
          is_error: true,
          result: detail || `${input.runtime.displayName} exited with code ${exitCode}.`,
          usage: { status: 'unavailable', source: 'local_cli' },
          session_id: input.sessionId,
        })
        return
      }

      const assistantText = adapter.extractAssistantText(stdout) || stdout.trim()
      if (assistantText.trim()) {
        input.onEvent({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [{ type: 'text', text: assistantText.trim() }],
          },
          session_id: input.sessionId,
        })
      }
      input.onEvent({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: '',
        usage: { status: 'unavailable', source: 'local_cli' },
        session_id: input.sessionId,
      })
    })()

    return { proc, outputDrain, done }
  }

  private buildProcessEnv(
    baseEnv: Record<string, string>,
    runtime: SelectedLocalCliRuntime,
  ): Record<string, string> {
    const contextEnv: Record<string, string> = {}
    if (runtime.autoCompactWindow) {
      contextEnv.CLAUDE_CODE_AUTO_COMPACT_WINDOW = String(runtime.autoCompactWindow)
    }
    if (
      runtime.modelContextWindows &&
      Object.keys(runtime.modelContextWindows).length > 0
    ) {
      contextEnv.CLAUDE_CODE_MODEL_CONTEXT_WINDOWS =
        JSON.stringify(runtime.modelContextWindows)
    }

    const env = {
      ...baseEnv,
      ...runtime.env,
      BEYA_EXECUTION_MODE: 'local_cli',
      BEYA_LOCAL_CLI_ID: runtime.id,
      BEYA_LOCAL_CLI_PATH: runtime.launchPath,
      BEYA_LOCAL_CLI_SELECTED_PATH: runtime.executablePath,
      ...contextEnv,
    }

    const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH'
    const existingPath = env[pathKey] ?? ''
    const prepend = [
      path.dirname(process.execPath),
      ...runtime.childPathPrepend,
      path.dirname(runtime.launchPath),
    ]
    const append = getWellKnownUserToolchainBins()
    const normalize = (entry: string) =>
      process.platform === 'win32'
        ? entry.replace(/[\\/]+$/, '').toLowerCase()
        : entry.replace(/[\\/]+$/, '')
    const seen = new Set<string>()
    const merged: string[] = []
    for (const entry of [
      ...prepend,
      ...existingPath.split(path.delimiter),
      ...append,
    ]) {
      if (!entry) continue
      const normalized = normalize(entry)
      if (seen.has(normalized)) continue
      seen.add(normalized)
      merged.push(entry)
    }
    env[pathKey] = merged.join(path.delimiter)
    return env
  }
}

export const localCliProxy = new LocalCliProxy()
