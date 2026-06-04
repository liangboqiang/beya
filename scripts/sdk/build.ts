import { mkdir, rm } from 'fs/promises'
import { join } from 'path'
import { spawnSync } from 'child_process'

const python = resolvePython()
const packageDir = join(process.cwd(), 'packages', 'sdk-python')
const sourceDir = join(packageDir, 'src')
const outputDir = join(process.cwd(), 'artifacts', 'sdk-pack', 'python')

await rm(outputDir, { recursive: true, force: true })
await mkdir(outputDir, { recursive: true })

run(python, ['-m', 'compileall', '-q', sourceDir], { shell: false })
run(python, [
  '-m',
  'pip',
  'wheel',
  packageDir,
  '--no-deps',
  '--wheel-dir',
  outputDir,
], { shell: false })

console.log(`Built Python SDK wheel into ${outputDir}`)

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
