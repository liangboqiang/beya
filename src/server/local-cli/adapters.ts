import type {
  LocalCliAdapter,
  LocalCliAdapterTurnInput,
  LocalCliInvocation,
} from './types.js'

function buildCodexInvocation(input: LocalCliAdapterTurnInput): LocalCliInvocation {
  const args = process.platform === 'win32' || process.env.WSL_DISTRO_NAME?.trim()
    ? ['exec', '--json', '--skip-git-repo-check', '--sandbox', 'danger-full-access']
    : [
        'exec',
        '--json',
        '--skip-git-repo-check',
        '--sandbox',
        'workspace-write',
        '-c',
        'sandbox_workspace_write.network_access=true',
      ]

  args.push('-c', 'default_permissions=":workspace"')
  if (input.model?.trim() && input.model.trim() !== 'default') {
    args.push('--model', input.model.trim())
  }
  args.push('-C', input.workDir)

  return { args, stdin: input.content }
}

function buildClaudeInvocation(input: LocalCliAdapterTurnInput): LocalCliInvocation {
  const args = [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
  ]
  if (input.model?.trim() && input.model.trim() !== 'default') {
    args.push('--model', input.model.trim())
  }

  return {
    args,
    stdin: JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: input.content,
      },
    }) + '\n',
  }
}

function buildGenericInvocation(input: LocalCliAdapterTurnInput): LocalCliInvocation {
  return { args: [], stdin: input.content }
}

function parseJsonLines(stdout: string): unknown[] {
  const result: unknown[] = []
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      result.push(JSON.parse(trimmed))
    } catch {
      // Some CLIs mix progress text with JSON; ignore non-JSON lines here.
    }
  }
  return result
}

function extractAssistantTextFromClaudeMessage(message: unknown): string {
  if (!message || typeof message !== 'object') return ''
  const record = message as Record<string, unknown>
  if (record.type !== 'assistant') return ''
  const nested = record.message
  if (!nested || typeof nested !== 'object') return ''
  const content = (nested as Record<string, unknown>).content
  if (!Array.isArray(content)) return ''
  return content
    .map((block) => {
      if (!block || typeof block !== 'object') return ''
      const blockRecord = block as Record<string, unknown>
      return blockRecord.type === 'text' && typeof blockRecord.text === 'string'
        ? blockRecord.text
        : ''
    })
    .filter(Boolean)
    .join('\n')
}

function readTextField(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string') return value
    if (Array.isArray(value)) {
      const text = value
        .map((entry) => {
          if (typeof entry === 'string') return entry
          if (entry && typeof entry === 'object') {
            return readTextField(entry as Record<string, unknown>, ['text', 'content'])
          }
          return ''
        })
        .filter(Boolean)
        .join('')
      if (text) return text
    }
  }
  return ''
}

function extractCodexEventText(message: unknown): string {
  if (!message || typeof message !== 'object') return ''
  const record = message as Record<string, unknown>
  const type = typeof record.type === 'string' ? record.type : ''
  if (!/(message|output_text|delta|completed)/i.test(type)) return ''

  const directText = readTextField(record, ['delta', 'text', 'output_text'])
  if (directText) return directText

  const item = record.item
  if (item && typeof item === 'object') {
    const itemRecord = item as Record<string, unknown>
    const itemText = readTextField(itemRecord, ['text', 'content', 'message'])
    if (itemText) return itemText
  }

  const messageValue = record.message
  if (messageValue && typeof messageValue === 'object') {
    return readTextField(messageValue as Record<string, unknown>, ['text', 'content'])
  }

  return ''
}

function extractClaudeAssistantText(stdout: string): string {
  return parseJsonLines(stdout)
    .map((message) => extractAssistantTextFromClaudeMessage(message))
    .filter(Boolean)
    .join('\n')
}

function extractCodexAssistantText(stdout: string): string {
  return parseJsonLines(stdout)
    .map((message) => extractCodexEventText(message))
    .filter(Boolean)
    .join('')
}

export const codexCliAdapter: LocalCliAdapter = {
  id: 'codex',
  buildInvocation: buildCodexInvocation,
  extractAssistantText: extractCodexAssistantText,
}

export const claudeCliAdapter: LocalCliAdapter = {
  id: 'claude',
  buildInvocation: buildClaudeInvocation,
  extractAssistantText: extractClaudeAssistantText,
}

export const genericCliAdapter: LocalCliAdapter = {
  id: 'generic',
  buildInvocation: buildGenericInvocation,
  extractAssistantText: () => '',
}

export function getLocalCliAdapter(runtimeId: string): LocalCliAdapter {
  if (runtimeId === codexCliAdapter.id) return codexCliAdapter
  if (runtimeId === claudeCliAdapter.id) return claudeCliAdapter
  return genericCliAdapter
}
