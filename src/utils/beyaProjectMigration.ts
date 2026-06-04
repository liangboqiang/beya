import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmdirSync,
  statSync,
  writeFileSync,
} from 'fs'
import { dirname, join, relative } from 'path'
import { logForDebugging } from './debug.js'
import { jsonStringify } from './slowOperations.js'

type MigrationMove = {
  source: string
  target: string
  kind: 'file' | 'directory'
}

type MigrationConflict = {
  source: string
  target: string
  reason: string
}

type MigrationManifest = {
  timestamp: string
  projectRoot: string
  status: 'planned' | 'completed' | 'failed'
  moves: MigrationMove[]
  conflicts: MigrationConflict[]
  backups: Array<{
    source: string
    backup: string
  }>
}

const ROOT_FILE_RENAMES = new Map([
  ['CLAUDE.md', 'BEYA.md'],
  ['CLAUDE.local.md', 'BEYA.local.md'],
])

function renameLegacySegment(segment: string): string {
  return ROOT_FILE_RENAMES.get(segment) ?? segment
}

function timestampForPath(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function copyBackup(source: string, backup: string): void {
  mkdirSync(dirname(backup), { recursive: true })
  const sourceStat = statSync(source)
  if (sourceStat.isDirectory()) {
    cpSync(source, backup, { recursive: true, force: true, errorOnExist: false })
  } else {
    copyFileSync(source, backup)
  }
}

function writeManifest(path: string, manifest: MigrationManifest): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, jsonStringify(manifest, null, 2) + '\n', 'utf8')
}

function collectMove(
  source: string,
  target: string,
  moves: MigrationMove[],
  conflicts: MigrationConflict[],
): void {
  if (!existsSync(source)) return

  const sourceStat = statSync(source)
  if (existsSync(target)) {
    const targetStat = statSync(target)
    if (sourceStat.isDirectory() && targetStat.isDirectory()) {
      for (const entry of readdirSync(source)) {
        collectMove(
          join(source, entry),
          join(target, renameLegacySegment(entry)),
          moves,
          conflicts,
        )
      }
      return
    }

    conflicts.push({
      source,
      target,
      reason: 'target already exists',
    })
    return
  }

  moves.push({
    source,
    target,
    kind: sourceStat.isDirectory() ? 'directory' : 'file',
  })
}

function removeEmptyLegacyDirs(path: string): void {
  if (!existsSync(path)) return
  const stat = statSync(path)
  if (!stat.isDirectory()) return

  for (const entry of readdirSync(path)) {
    removeEmptyLegacyDirs(join(path, entry))
  }

  try {
    rmdirSync(path)
  } catch {
    // Conflicted or unknown legacy content remains; keep it in place.
  }
}

export function migrateLegacyProjectFiles(projectRoot: string): boolean {
  const moves: MigrationMove[] = []
  const conflicts: MigrationConflict[] = []

  for (const [legacyName, targetName] of ROOT_FILE_RENAMES) {
    collectMove(
      join(projectRoot, legacyName),
      join(projectRoot, targetName),
      moves,
      conflicts,
    )
  }

  const legacyDir = join(projectRoot, '.claude')
  const targetDir = join(projectRoot, '.beya')
  if (existsSync(legacyDir)) {
    for (const entry of readdirSync(legacyDir)) {
      collectMove(
        join(legacyDir, entry),
        join(targetDir, renameLegacySegment(entry)),
        moves,
        conflicts,
      )
    }
  }

  if (moves.length === 0 && conflicts.length === 0) {
    return false
  }

  const timestamp = timestampForPath()
  const backupRoot = join(targetDir, 'migration-backups', timestamp)
  const manifestPath = join(backupRoot, 'manifest.json')
  const manifest: MigrationManifest = {
    timestamp,
    projectRoot,
    status: 'planned',
    moves,
    conflicts,
    backups: [],
  }

  try {
    for (const move of moves) {
      const backupPath = join(backupRoot, relative(projectRoot, move.source))
      copyBackup(move.source, backupPath)
      manifest.backups.push({ source: move.source, backup: backupPath })
    }

    writeManifest(manifestPath, manifest)

    for (const move of moves) {
      mkdirSync(dirname(move.target), { recursive: true })
      renameSync(move.source, move.target)
    }

    removeEmptyLegacyDirs(legacyDir)
    manifest.status = 'completed'
    writeManifest(manifestPath, manifest)
    logForDebugging(
      `[Beya project migration] moved ${moves.length} legacy path(s), conflicts=${conflicts.length}`,
    )
    return true
  } catch (error) {
    manifest.status = 'failed'
    try {
      writeManifest(manifestPath, manifest)
    } catch {
      // The original failure is more useful than a manifest write failure.
    }
    logForDebugging(
      `[Beya project migration] failed: ${error instanceof Error ? error.message : String(error)}`,
      { level: 'warn' },
    )
    return false
  }
}
