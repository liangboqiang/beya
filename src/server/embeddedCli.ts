function isCliEntrypointArg(arg: string): boolean {
  const normalized = arg.replace(/\\/g, '/')
  return normalized.endsWith('/src/entrypoints/cli.tsx') ||
    normalized.endsWith('/entrypoints/cli.tsx')
}

type MacroFallback = {
  VERSION: string
  BUILD_TIME: string
  PACKAGE_URL: string
  NATIVE_PACKAGE_URL: string
  FEEDBACK_CHANNEL: string
  ISSUES_EXPLAINER: string
  VERSION_CHANGELOG: string
}

export function ensureEmbeddedCliMacroFallback(): void {
  const globalWithMacro = globalThis as typeof globalThis & { MACRO?: Partial<MacroFallback> }
  globalWithMacro.MACRO = {
    VERSION: process.env.BEYA_VERSION || '0.1.0',
    BUILD_TIME: process.env.BEYA_BUILD_TIME || '',
    PACKAGE_URL: process.env.BEYA_PACKAGE_URL || 'beya',
    NATIVE_PACKAGE_URL: process.env.BEYA_NATIVE_PACKAGE_URL || 'beya',
    FEEDBACK_CHANNEL: process.env.BEYA_FEEDBACK_CHANNEL || 'Beya support',
    ISSUES_EXPLAINER: process.env.BEYA_ISSUES_EXPLAINER || '',
    VERSION_CHANGELOG: process.env.BEYA_VERSION_CHANGELOG || '',
    ...(globalWithMacro.MACRO ?? {}),
  }
}

export function extractEmbeddedCliArgs(argv: string[] = process.argv): string[] | null {
  const markerIndex = argv.findIndex(isCliEntrypointArg)
  if (markerIndex === -1) {
    return null
  }
  return argv.slice(markerIndex + 1)
}

export async function runEmbeddedCliIfRequested(argv: string[] = process.argv): Promise<boolean> {
  const cliArgs = extractEmbeddedCliArgs(argv)
  if (!cliArgs) {
    return false
  }

  const command = argv[0] ?? 'beya-server'
  const previousArgv = process.argv
  const previousSuppressAutorun = process.env.BEYA_SUPPRESS_CLI_AUTORUN

  process.argv = [command, command, ...cliArgs]
  process.env.BEYA_SUPPRESS_CLI_AUTORUN = '1'

  try {
    ensureEmbeddedCliMacroFallback()
    const { main } = await import('../entrypoints/cli.js')
    await main()
  } finally {
    process.argv = previousArgv
    if (previousSuppressAutorun === undefined) {
      delete process.env.BEYA_SUPPRESS_CLI_AUTORUN
    } else {
      process.env.BEYA_SUPPRESS_CLI_AUTORUN = previousSuppressAutorun
    }
  }

  return true
}
