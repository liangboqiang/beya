import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'fs'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, test } from 'bun:test'
import { migrateLegacyProjectFiles } from '../beyaProjectMigration.js'

function makeTempProject() {
  return mkdtempSync(join(tmpdir(), 'beya-project-migration-'))
}

function readText(path: string) {
  return readFileSync(path, 'utf8')
}

describe('migrateLegacyProjectFiles', () => {
  test('moves legacy project files into Beya paths with backups', () => {
    const root = makeTempProject()
    writeFileSync(join(root, 'CLAUDE.md'), 'project instructions')
    writeFileSync(join(root, 'CLAUDE.local.md'), 'private instructions')
    mkdirSync(join(root, '.claude'), { recursive: true })
    writeFileSync(join(root, '.claude', 'settings.json'), '{}', {
      flag: 'w',
    })
    writeFileSync(join(root, '.claude', 'CLAUDE.md'), 'nested instructions', {
      flag: 'w',
    })

    expect(migrateLegacyProjectFiles(root)).toBe(true)

    expect(readText(join(root, 'BEYA.md'))).toBe('project instructions')
    expect(readText(join(root, 'BEYA.local.md'))).toBe(
      'private instructions',
    )
    expect(readText(join(root, '.beya', 'settings.json'))).toBe('{}')
    expect(readText(join(root, '.beya', 'BEYA.md'))).toBe(
      'nested instructions',
    )
    expect(existsSync(join(root, 'CLAUDE.md'))).toBe(false)
    expect(existsSync(join(root, 'CLAUDE.local.md'))).toBe(false)

    const backupsRoot = join(root, '.beya', 'migration-backups')
    const backupRuns = readdirSync(backupsRoot)
    expect(backupRuns.length).toBe(1)
    const manifest = JSON.parse(
      readText(join(backupsRoot, backupRuns[0]!, 'manifest.json')),
    )
    expect(manifest.status).toBe('completed')
    expect(manifest.moves).toHaveLength(4)
    expect(manifest.backups).toHaveLength(4)
  })

  test('does not overwrite existing Beya targets', () => {
    const root = makeTempProject()
    writeFileSync(join(root, 'CLAUDE.md'), 'legacy instructions')
    writeFileSync(join(root, 'BEYA.md'), 'current instructions')

    expect(migrateLegacyProjectFiles(root)).toBe(true)

    expect(readText(join(root, 'BEYA.md'))).toBe('current instructions')
    expect(readText(join(root, 'CLAUDE.md'))).toBe('legacy instructions')

    const backupsRoot = join(root, '.beya', 'migration-backups')
    const backupRuns = readdirSync(backupsRoot)
    const manifest = JSON.parse(
      readText(join(backupsRoot, backupRuns[0]!, 'manifest.json')),
    )
    expect(manifest.moves).toHaveLength(0)
    expect(manifest.conflicts).toHaveLength(1)
    expect(manifest.conflicts[0].reason).toBe('target already exists')
  })
})
