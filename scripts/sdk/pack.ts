import { spawnSync } from 'child_process'

const result = spawnSync('bun', ['run', 'sdk:build'], {
  cwd: process.cwd(),
  stdio: 'inherit',
  shell: process.platform === 'win32',
})
if (result.status !== 0) process.exit(result.status ?? 1)
