import { join } from 'path'
import { spawnSync } from 'child_process'

const python = resolvePython()
const pythonSrc = join(process.cwd(), 'packages', 'sdk-python', 'src')

run('bun', ['test', 'tests/gatewaySdkContract.test.ts'])
run(python, [
  '-m',
  'unittest',
  'discover',
  '-s',
  join(process.cwd(), 'packages', 'sdk-python', 'tests'),
  '-p',
  'test_*.py',
], { shell: false })
run(python, ['-m', 'compileall', '-q', pythonSrc], { shell: false })
run(python, [
  '-c',
  [
    'import sys',
    `sys.path.insert(0, ${JSON.stringify(pythonSrc)})`,
    'from beya import AsyncBeyaClient, BeyaClient, LocalExecutionError, RunEvent',
    'from beya.cli import main',
    'client = BeyaClient(base_url="http://127.0.0.1:3456")',
    'assert client.base_url == "http://127.0.0.1:3456"',
    'assert hasattr(client, "tasks") and hasattr(client, "workspace")',
    'assert hasattr(client, "providers") and hasattr(client, "plugins")',
    'assert AsyncBeyaClient is not None and LocalExecutionError is not None and RunEvent is not None',
    'assert callable(main)',
  ].join('; '),
], { shell: false })
run('bun', ['run', 'sdk:build'])

function run(
  command: string,
  args: string[],
  options: { shell?: boolean } = {},
) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
    shell: options.shell ?? process.platform === 'win32',
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function resolvePython(): string {
  const bundled = join(
    process.env.USERPROFILE || '',
    '.cache',
    'codex-runtimes',
    'codex-primary-runtime',
    'dependencies',
    'python',
    process.platform === 'win32' ? 'python.exe' : 'bin/python',
  )
  const candidates = [
    process.env.PYTHON,
    'python',
    bundled,
  ].filter((candidate): candidate is string => Boolean(candidate))

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['--version'], {
      cwd: process.cwd(),
      stdio: 'ignore',
      shell: process.platform === 'win32',
    })
    if (result.status === 0) return candidate
  }

  throw new Error('No Python executable found. Set PYTHON to run Python SDK checks.')
}
