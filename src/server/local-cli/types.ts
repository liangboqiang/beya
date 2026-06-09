import type { SelectedLocalCliRuntime } from '../services/localCliRuntimeService.js'

export type LocalCliStreamName = 'stdout' | 'stderr'

export type LocalCliInvocation = {
  args: string[]
  stdin: string
}

export type LocalCliAdapterTurnInput = {
  runtime: SelectedLocalCliRuntime
  workDir: string
  model?: string
  content: string
}

export type LocalCliAdapter = {
  id: string
  buildInvocation(input: LocalCliAdapterTurnInput): LocalCliInvocation
  extractAssistantText(stdout: string): string
}

export type LocalCliEvent = Record<string, unknown>

export type LocalCliTurnHandle = {
  proc: ReturnType<typeof Bun.spawn>
  outputDrain: Promise<void>
  done: Promise<void>
}

export type LocalCliTurnInput = {
  sessionId: string
  runtime: SelectedLocalCliRuntime
  workDir: string
  model?: string
  content: string
  baseEnv: Record<string, string>
  redactOutput: (text: string) => string
  onCapturedLine: (streamName: LocalCliStreamName, line: string) => void
  onEvent: (event: LocalCliEvent) => void
}
