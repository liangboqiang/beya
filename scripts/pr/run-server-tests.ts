#!/usr/bin/env bun

import { readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { loadQuarantineManifest, quarantinedPathSet } from '../quality-gate/quarantine'

const root = process.cwd()
const roots = ['src/server', 'src/tools', 'src/utils']
const excludedFiles = quarantinedPathSet(loadQuarantineManifest(undefined, { enforceReviewDate: true }))

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

if (testFiles.length === 0) {
  console.log('No server-side test files found.')
  process.exit(0)
}

const failures: string[] = []

for (const testFile of testFiles) {
  const proc = Bun.spawn(['bun', 'test', testFile], {
    cwd: root,
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
  process.exit(1)
}

process.exit(0)
