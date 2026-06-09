import type { LocalCliStreamName } from './types.js'

function quoteWindowsCommandArg(arg: string): string {
  if (!/[()\][%!^"`<>&|;,\s]/.test(arg)) {
    return arg
  }
  return `"${arg.replace(/(["\\])/g, '\\$1')}"`
}

export function wrapLocalCliCommandForPlatform(command: string, args: string[]): string[] {
  const extension = command.split(/[\\/]/).pop()?.toLowerCase().match(/\.[^.]+$/)?.[0] ?? ''
  if (process.platform === 'win32' && (extension === '.cmd' || extension === '.bat')) {
    return [
      'cmd.exe',
      '/d',
      '/s',
      '/c',
      [quoteWindowsCommandArg(command), ...args.map(quoteWindowsCommandArg)].join(' '),
    ]
  }
  return [command, ...args]
}

export async function writeLocalCliStdin(
  proc: ReturnType<typeof Bun.spawn>,
  input: string,
): Promise<void> {
  if (!proc.stdin) return
  const stdin = proc.stdin as unknown as {
    write?: (chunk: string | Uint8Array) => unknown
    end?: () => unknown
    getWriter?: () => {
      write: (chunk: Uint8Array) => Promise<void>
      close: () => Promise<void>
    }
  }

  try {
    if (typeof stdin.write === 'function') {
      stdin.write(input)
      stdin.end?.()
      return
    }

    if (typeof stdin.getWriter === 'function') {
      const writer = stdin.getWriter()
      await writer.write(new TextEncoder().encode(input))
      await writer.close()
    }
  } catch {
    // If the child exits early, writing stdin can fail. The process exit path
    // will surface the actionable error.
  }
}

export async function collectLocalCliOutputStream(
  stream: ReadableStream | null | undefined,
  streamName: LocalCliStreamName,
  redactOutput: (text: string) => string,
  onCapturedLine: (streamName: LocalCliStreamName, line: string) => void,
): Promise<string> {
  if (!stream) return ''
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let output = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const text = decoder.decode(value, { stream: true })
      output += text

      for (const line of text
        .split('\n')
        .map((entry) => entry.trim())
        .filter(Boolean)) {
        onCapturedLine(streamName, redactOutput(line))
      }
    }
  } catch {
    // Output capture failure should not kill the session.
  }

  return output
}
