#!/usr/bin/env bun

import { readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { loadQuarantineManifest, quarantinedPathSet } from '../quality-gate/quarantine'

const root = process.cwd()
const roots = ['src/server', 'src/tools', 'src/utils']
const excludedFiles = quarantinedPathSet(loadQuarantineManifest(undefined, { enforceReviewDate: true }))
const integrationTestFiles = new Set([
  'src/server/__tests__/conversations.test.ts',
  'src/server/__tests__/e2e/business-flow.test.ts',
  'src/server/__tests__/e2e/full-flow.test.ts',
  'src/server/__tests__/real-llm-test.ts',
])
const testEnv = {
  ...process.env,
  NODE_ENV: 'test',
  BEYA_CLIENT_DISCONNECT_CLEANUP_MS: process.env.BEYA_CLIENT_DISCONNECT_CLEANUP_MS ?? '1000',
}

type TestProfile = 'full' | 'fast' | 'integration'

function readProfile(argv: string[]): TestProfile {
  const index = argv.indexOf('--profile')
  if (index === -1) return 'full'

  const value = argv[index + 1]
  if (value === 'full' || value === 'fast' || value === 'integration') {
    return value
  }

  throw new Error('Usage: bun run scripts/pr/run-server-tests.ts [--profile full|fast|integration]')
}

function normalize(path: string) {
  return relative(root, path).split(sep).join('/')
}

function walk(path: string, files: string[]) {
  const stat = statSync(path)

  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) {
      walk(join(path, entry), files)
    }
    return
  }

  if (!stat.isFile()) {
    return
  }

  const normalized = normalize(path)
  if (normalized.endsWith('.test.ts') && !excludedFiles.has(normalized)) {
    files.push(normalized)
  }
}

const testFiles: string[] = []
for (const testRoot of roots) {
  walk(join(root, testRoot), testFiles)
}

testFiles.sort()
const profile = readProfile(process.argv.slice(2))
const selectedTestFiles = testFiles.filter((testFile) => {
  const isIntegration = integrationTestFiles.has(testFile) || testFile.startsWith('src/server/__tests__/e2e/')
  if (profile === 'fast') return !isIntegration
  if (profile === 'integration') return isIntegration
  return true
})

if (selectedTestFiles.length === 0) {
  console.log('No server-side test files found.')
  process.exit(0)
}

async function runBatched() {
  const proc = Bun.spawn(['bun', 'test', '--parallel=1', '--timeout=20000', ...selectedTestFiles], {
    cwd: root,
    env: testEnv,
    stdout: 'inherit',
    stderr: 'inherit',
  })
  return proc.exited
}

async function runIsolated() {
  const failures: string[] = []

  for (const testFile of selectedTestFiles) {
    const proc = Bun.spawn(['bun', 'test', '--timeout=20000', testFile], {
      cwd: root,
      env: testEnv,
      stdout: 'inherit',
      stderr: 'inherit',
    })
    const exitCode = await proc.exited
    if (exitCode !== 0) {
      failures.push(testFile)
    }
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} server-side test file(s) failed:`)
    for (const failure of failures) {
      console.error(`- ${failure}`)
    }
    return 1
  }

  return 0
}

console.log(`Server test profile: ${profile}; files=${selectedTestFiles.length}; excluded=${testFiles.length - selectedTestFiles.length}`)

const exitCode = process.env.SERVER_TEST_ISOLATE === '1'
  ? await runIsolated()
  : await runBatched()

process.exit(exitCode)
