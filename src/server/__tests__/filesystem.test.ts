import { afterEach, describe, expect, it } from 'bun:test'
import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as fsp from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import {
  ensureTrailingPathSeparator,
  handleFilesystemRoute,
  isPickerCancel,
  normalizeInitialDirectory,
  normalizePickedDirectoryOutput,
  pickLinuxDirectory,
  pickSystemDirectory,
  runDirectoryPickerCommand,
} from '../api/filesystem.js'
import { handleApiRequest } from '../router.js'
import { clearFilesystemAccessRootsForTests } from '../services/filesystemAccessRoots.js'
import { getRepositoryContext } from '../services/repositoryLaunchService.js'
import { enableConfigs } from '../../utils/config.js'

const cleanupDirs = new Set<string>()

enableConfigs()

function makeUrl(route: string, params: Record<string, string>): URL {
  const url = new URL(`http://localhost${route}`)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  return url
}

afterEach(async () => {
  for (const dir of cleanupDirs) {
    await fsp.rm(dir, { recursive: true, force: true })
  }
  cleanupDirs.clear()
  clearFilesystemAccessRootsForTests()
})

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
  })
}

function isWithinPath(targetPath: string, rootPath: string): boolean {
  const target = path.resolve(targetPath)
  const root = path.resolve(rootPath)
  return target === root || target.startsWith(`${root}${path.sep}`)
}

async function makeExternalFixtureDir(): Promise<string | null> {
  const candidates = ['/var/tmp', '/private/var/tmp', '/Users/Shared']

  for (const baseDir of candidates) {
    try {
      const stat = await fsp.stat(baseDir)
      if (!stat.isDirectory()) continue
      const fixtureDir = await fsp.mkdtemp(path.join(baseDir, 'claude-filesystem-test-'))
      const isDefaultAllowed =
        isWithinPath(fixtureDir, os.homedir()) ||
        isWithinPath(fixtureDir, '/tmp') ||
        (process.platform === 'darwin' && isWithinPath(fixtureDir, '/private/tmp'))
      if (!isDefaultAllowed) return fixtureDir
      await fsp.rm(fixtureDir, { recursive: true, force: true })
    } catch {
      // Try the next common writable system directory.
    }
  }

  return null
}

describe('filesystem API', () => {
  it('normalizes native picker stdout to the first non-empty path', () => {
    expect(normalizePickedDirectoryOutput('\r\n  C:\\Users\\ASUS\\Project  \r\nignored')).toBe('C:\\Users\\ASUS\\Project')
    expect(normalizePickedDirectoryOutput('\n\n')).toBeNull()
  })

  it('normalizes native picker helper inputs without launching a dialog', async () => {
    const fixtureDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'claude-filesystem-helper-'))
    cleanupDirs.add(fixtureDir)
    const filePath = path.join(fixtureDir, 'note.txt')
    await fsp.writeFile(filePath, 'hello')

    expect(normalizeInitialDirectory()).toBe('')
    expect(normalizeInitialDirectory(fixtureDir)).toBe(path.resolve(fixtureDir))
    expect(normalizeInitialDirectory(filePath)).toBe('')
    expect(normalizeInitialDirectory(path.join(fixtureDir, 'missing'))).toBe('')

    expect(ensureTrailingPathSeparator(fixtureDir)).toBe(`${fixtureDir}${path.sep}`)
    expect(ensureTrailingPathSeparator(`${fixtureDir}${path.sep}`)).toBe(`${fixtureDir}${path.sep}`)
    expect(isPickerCancel('')).toBe(true)
    expect(isPickerCancel('User canceled', ['User canceled'])).toBe(true)
    expect(isPickerCancel('fatal error', ['User canceled'])).toBe(false)
  })

  it('runs native picker commands with cancel and error handling', async () => {
    const fixtureDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'claude-filesystem-command-'))
    cleanupDirs.add(fixtureDir)
    const quotedFixtureDir = JSON.stringify(fixtureDir)

    await expect(runDirectoryPickerCommand(
      process.execPath,
      ['-e', `console.log(process.env.BEYA_PICK_DIRECTORY_INITIAL ?? '')`],
      fixtureDir,
    )).resolves.toBe(fixtureDir)

    await expect(runDirectoryPickerCommand(
      process.execPath,
      ['-e', "console.error('User canceled'); process.exit(1)"],
      '',
      { cancelSignals: ['User canceled'] },
    )).resolves.toBeNull()

    await expect(runDirectoryPickerCommand(
      process.execPath,
      ['-e', `console.log(${quotedFixtureDir}); process.exit(1)`],
      '',
    )).resolves.toBe(fixtureDir)

    await expect(runDirectoryPickerCommand(
      process.execPath,
      ['-e', "console.error('picker failed'); process.exit(1)"],
      '',
    )).rejects.toThrow('picker failed')
  })

  it('selects Windows and macOS picker commands through an injected runner', async () => {
    const fixtureDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'claude-filesystem-picker-'))
    cleanupDirs.add(fixtureDir)

    await expect(pickSystemDirectory(fixtureDir, {
      platform: 'win32',
      runCommand: async (command, args, initialPath, options) => {
        expect(command).toBe('powershell.exe')
        expect(args).toEqual(expect.arrayContaining(['-STA', '-Command']))
        expect(args.at(-1)).toContain('FolderBrowserDialog')
        expect(initialPath).toBe(path.resolve(fixtureDir))
        expect(options?.cancelSignals).toEqual(['OperationCanceledException'])
        return 'C:\\picked'
      },
    })).resolves.toBe('C:\\picked')

    await expect(pickSystemDirectory(path.join(fixtureDir, 'missing'), {
      platform: 'darwin',
      runCommand: async (command, args, initialPath, options) => {
        expect(command).toBe('osascript')
        expect(args).toEqual(expect.arrayContaining(['-e']))
        expect(args.at(-1)).toContain('choose folder')
        expect(initialPath).toBe('')
        expect(options?.cancelSignals).toEqual(['User canceled', '(-128)'])
        return '/Users/asus/project'
      },
    })).resolves.toBe('/Users/asus/project')
  })

  it('uses Linux picker availability checks and command-specific arguments', async () => {
    const calls: string[] = []
    const fallbackSelection = await pickLinuxDirectory('', {
      homeDir: '/home/asus',
      isCommandAvailable: async (command) => {
        calls.push(command)
        return command === 'kdialog'
      },
      runCommand: async (command, args, initialPath) => {
        expect(command).toBe('kdialog')
        expect(args).toEqual(['--getexistingdirectory', '/home/asus'])
        expect(initialPath).toBe('')
        return '/home/asus/project'
      },
    })

    expect(calls).toEqual(['zenity', 'kdialog'])
    expect(fallbackSelection).toBe('/home/asus/project')

    const fixtureDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'claude-filesystem-picker-'))
    cleanupDirs.add(fixtureDir)
    const zenitySelection = await pickLinuxDirectory(fixtureDir, {
      isCommandAvailable: async (command) => command === 'zenity',
      runCommand: async (command, args, initialPath) => {
        expect(command).toBe('zenity')
        expect(args).toEqual(expect.arrayContaining([
          '--filename',
          ensureTrailingPathSeparator(fixtureDir),
        ]))
        expect(initialPath).toBe(fixtureDir)
        return fixtureDir
      },
    })
    expect(zenitySelection).toBe(fixtureDir)

    await expect(pickLinuxDirectory('', {
      isCommandAvailable: async () => false,
      runCommand: async () => {
        throw new Error('should not run')
      },
    })).rejects.toThrow('No native directory picker is available')
  })

  it('rejects non-POST directory picker requests', async () => {
    const res = await handleFilesystemRoute(
      '/api/filesystem/pick-directory',
      makeUrl('/api/filesystem/pick-directory', {}),
      new Request('http://localhost/api/filesystem/pick-directory', { method: 'GET' }),
      { pickDirectory: async () => null },
    )

    expect(res.status).toBe(405)
    await expect(res.json()).resolves.toEqual({ error: 'Method not allowed' })
  })

  it('returns a null directory selection when the native picker is canceled', async () => {
    const res = await handleFilesystemRoute(
      '/api/filesystem/pick-directory',
      makeUrl('/api/filesystem/pick-directory', {}),
      new Request('http://localhost/api/filesystem/pick-directory', {
        method: 'POST',
        body: '{not-json',
      }),
      {
        pickDirectory: async (initialPath) => {
          expect(initialPath).toBeUndefined()
          return null
        },
      },
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ selectedPath: null })
  })

  it('registers a picked directory without relying on a platform dialog', async () => {
    const fixtureDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'claude-filesystem-picker-'))
    cleanupDirs.add(fixtureDir)

    const res = await handleFilesystemRoute(
      '/api/filesystem/pick-directory',
      makeUrl('/api/filesystem/pick-directory', {}),
      new Request('http://localhost/api/filesystem/pick-directory', {
        method: 'POST',
        body: JSON.stringify({ initialPath: fixtureDir }),
      }),
      {
        pickDirectory: async (initialPath) => {
          expect(initialPath).toBe(fixtureDir)
          return fixtureDir
        },
      },
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      selectedPath: path.resolve(fixtureDir),
    })
  })

  it('rejects picked paths that are missing or not directories', async () => {
    const fixtureDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'claude-filesystem-picker-'))
    cleanupDirs.add(fixtureDir)
    const filePath = path.join(fixtureDir, 'note.txt')
    await fsp.writeFile(filePath, 'hello')

    const fileRes = await handleFilesystemRoute(
      '/api/filesystem/pick-directory',
      makeUrl('/api/filesystem/pick-directory', {}),
      new Request('http://localhost/api/filesystem/pick-directory', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
      { pickDirectory: async () => filePath },
    )
    expect(fileRes.status).toBe(400)
    await expect(fileRes.json()).resolves.toEqual({
      error: 'Not a directory',
      path: path.resolve(filePath),
    })

    const missingPath = path.join(fixtureDir, 'missing')
    const missingRes = await handleFilesystemRoute(
      '/api/filesystem/pick-directory',
      makeUrl('/api/filesystem/pick-directory', {}),
      new Request('http://localhost/api/filesystem/pick-directory', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
      { pickDirectory: async () => missingPath },
    )
    expect(missingRes.status).toBe(404)
    await expect(missingRes.json()).resolves.toEqual({
      error: 'Directory not found',
      path: path.resolve(missingPath),
    })
  })

  it('validates desktop directory registration requests', async () => {
    const getRes = await handleFilesystemRoute(
      '/api/filesystem/register-directory',
      makeUrl('/api/filesystem/register-directory', {}),
      new Request('http://localhost/api/filesystem/register-directory', { method: 'GET' }),
    )
    expect(getRes.status).toBe(405)

    const missingRes = await handleFilesystemRoute(
      '/api/filesystem/register-directory',
      makeUrl('/api/filesystem/register-directory', {}),
      new Request('http://localhost/api/filesystem/register-directory', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    )
    expect(missingRes.status).toBe(400)
    await expect(missingRes.json()).resolves.toEqual({ error: 'path is required' })

    const invalidJsonRes = await handleFilesystemRoute(
      '/api/filesystem/register-directory',
      makeUrl('/api/filesystem/register-directory', {}),
      new Request('http://localhost/api/filesystem/register-directory', {
        method: 'POST',
        body: '[',
      }),
    )
    expect(invalidJsonRes.status).toBe(400)
    await expect(invalidJsonRes.json()).resolves.toEqual({ error: 'path is required' })
  })

  it('registers a desktop directory path and rejects file paths', async () => {
    const fixtureDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'claude-filesystem-register-'))
    cleanupDirs.add(fixtureDir)
    const filePath = path.join(fixtureDir, 'note.txt')
    await fsp.writeFile(filePath, 'hello')

    const fileRes = await handleFilesystemRoute(
      '/api/filesystem/register-directory',
      makeUrl('/api/filesystem/register-directory', {}),
      new Request('http://localhost/api/filesystem/register-directory', {
        method: 'POST',
        body: JSON.stringify({ path: filePath }),
      }),
    )
    expect(fileRes.status).toBe(400)

    const res = await handleFilesystemRoute(
      '/api/filesystem/register-directory',
      makeUrl('/api/filesystem/register-directory', {}),
      new Request('http://localhost/api/filesystem/register-directory', {
        method: 'POST',
        body: JSON.stringify({ path: fixtureDir }),
      }),
    )

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      selectedPath: path.resolve(fixtureDir),
    })
  })

  it('allows browsing a directory under the user home directory', async () => {
    const homeFixtureDir = await fsp.mkdtemp(path.join(os.homedir(), 'claude-filesystem-test-'))
    cleanupDirs.add(homeFixtureDir)
    await fsp.mkdir(path.join(homeFixtureDir, '.config'))
    await fsp.mkdir(path.join(homeFixtureDir, '.git'))
    await fsp.writeFile(path.join(homeFixtureDir, 'note.txt'), 'hello')
    await fsp.writeFile(path.join(homeFixtureDir, '.env.local'), 'SECRET=example')

    const res = await handleFilesystemRoute(
      '/api/filesystem/browse',
      makeUrl('/api/filesystem/browse', {
        path: homeFixtureDir,
        includeFiles: 'true',
      }),
    )

    expect(res.status).toBe(200)
    const body = await res.json() as { entries: Array<{ name: string }> }
    expect(body.entries.some((entry) => entry.name === '.config')).toBe(true)
    expect(body.entries.some((entry) => entry.name === '.env.local')).toBe(true)
    expect(body.entries.some((entry) => entry.name === '.git')).toBe(false)
    expect(body.entries.some((entry) => entry.name === 'note.txt')).toBe(true)
  })

  it('allows browsing a selected workspace outside the default home/tmp roots', async () => {
    const externalFixtureDir = await makeExternalFixtureDir()
    if (!externalFixtureDir) return

    cleanupDirs.add(externalFixtureDir)
    await fsp.writeFile(path.join(externalFixtureDir, 'note.txt'), 'hello')

    const deniedRes = await handleFilesystemRoute(
      '/api/filesystem/browse',
      makeUrl('/api/filesystem/browse', {
        path: externalFixtureDir,
        includeFiles: 'true',
      }),
    )
    expect(deniedRes.status).toBe(403)

    await getRepositoryContext(externalFixtureDir)

    const res = await handleFilesystemRoute(
      '/api/filesystem/browse',
      makeUrl('/api/filesystem/browse', {
        path: externalFixtureDir,
        includeFiles: 'true',
      }),
    )

    expect(res.status).toBe(200)
    const body = await res.json() as { entries: Array<{ name: string }> }
    expect(body.entries.some((entry) => entry.name === 'note.txt')).toBe(true)
  })

  it('registers a directory selected through the native picker endpoint', async () => {
    const externalFixtureDir = await makeExternalFixtureDir()
    if (!externalFixtureDir) return

    cleanupDirs.add(externalFixtureDir)
    await fsp.writeFile(path.join(externalFixtureDir, 'note.txt'), 'hello')

    const deniedRes = await handleFilesystemRoute(
      '/api/filesystem/browse',
      makeUrl('/api/filesystem/browse', {
        path: externalFixtureDir,
        includeFiles: 'true',
      }),
    )
    expect(deniedRes.status).toBe(403)

    const pickRes = await handleFilesystemRoute(
      '/api/filesystem/pick-directory',
      makeUrl('/api/filesystem/pick-directory', {}),
      new Request('http://localhost/api/filesystem/pick-directory', {
        method: 'POST',
        body: JSON.stringify({ initialPath: externalFixtureDir }),
      }),
      {
        pickDirectory: async (initialPath) => {
          expect(initialPath).toBe(externalFixtureDir)
          return externalFixtureDir
        },
      },
    )
    expect(pickRes.status).toBe(200)
    await expect(pickRes.json()).resolves.toEqual({
      selectedPath: path.resolve(externalFixtureDir),
    })

    const browseRes = await handleFilesystemRoute(
      '/api/filesystem/browse',
      makeUrl('/api/filesystem/browse', {
        path: externalFixtureDir,
        includeFiles: 'true',
      }),
    )
    expect(browseRes.status).toBe(200)
  })

  it('passes picker POST requests through the unified API router', async () => {
    const externalFixtureDir = await makeExternalFixtureDir()
    if (!externalFixtureDir) return

    cleanupDirs.add(externalFixtureDir)
    const req = new Request('http://localhost/api/filesystem/pick-directory', {
      method: 'POST',
      body: JSON.stringify({ initialPath: externalFixtureDir }),
    })

    const res = await handleApiRequest(req, new URL(req.url), {
      filesystem: {
        pickDirectory: async (initialPath) => {
          expect(initialPath).toBe(externalFixtureDir)
          return externalFixtureDir
        },
      },
    })

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      selectedPath: path.resolve(externalFixtureDir),
    })
  })

  it('registers a directory selected by the desktop-native dialog', async () => {
    const externalFixtureDir = await makeExternalFixtureDir()
    if (!externalFixtureDir) return

    cleanupDirs.add(externalFixtureDir)
    await fsp.writeFile(path.join(externalFixtureDir, 'note.txt'), 'hello')

    const deniedRes = await handleFilesystemRoute(
      '/api/filesystem/browse',
      makeUrl('/api/filesystem/browse', {
        path: externalFixtureDir,
        includeFiles: 'true',
      }),
    )
    expect(deniedRes.status).toBe(403)

    const req = new Request('http://localhost/api/filesystem/register-directory', {
      method: 'POST',
      body: JSON.stringify({ path: externalFixtureDir }),
    })
    const registerRes = await handleApiRequest(req, new URL(req.url))

    expect(registerRes.status).toBe(200)
    await expect(registerRes.json()).resolves.toEqual({
      selectedPath: path.resolve(externalFixtureDir),
    })

    const browseRes = await handleFilesystemRoute(
      '/api/filesystem/browse',
      makeUrl('/api/filesystem/browse', {
        path: externalFixtureDir,
        includeFiles: 'true',
      }),
    )
    expect(browseRes.status).toBe(200)
  })

  it('fuzzy searches files and directories below the selected root', async () => {
    const homeFixtureDir = await fsp.mkdtemp(path.join(os.homedir(), 'claude-filesystem-test-'))
    cleanupDirs.add(homeFixtureDir)
    git(homeFixtureDir, 'init')
    await fsp.mkdir(path.join(homeFixtureDir, 'src', 'commands'), { recursive: true })
    await fsp.mkdir(path.join(homeFixtureDir, 'src', 'commands', 'files'), { recursive: true })
    await fsp.mkdir(path.join(homeFixtureDir, 'src', 'constants'), { recursive: true })
    await fsp.mkdir(path.join(homeFixtureDir, 'src', 'hooks'), { recursive: true })
    await fsp.mkdir(path.join(homeFixtureDir, 'desktop', 'src'), { recursive: true })
    await fsp.mkdir(path.join(homeFixtureDir, 'scripts', 'quality-gate', 'baseline', 'fixtures', 'cross-module-refactor', 'src'), { recursive: true })
    await fsp.mkdir(path.join(homeFixtureDir, '__pycache__'), { recursive: true })
    await fsp.mkdir(path.join(homeFixtureDir, 'node_modules', 'pkg'), { recursive: true })
    await fsp.mkdir(path.join(homeFixtureDir, '.venv', 'lib'), { recursive: true })
    await fsp.mkdir(path.join(homeFixtureDir, 'tmp-ignore'), { recursive: true })
    await fsp.writeFile(path.join(homeFixtureDir, '.gitignore'), ['__pycache__/', 'node_modules/', '.venv/', 'venv/'].join('\n'))
    await fsp.writeFile(path.join(homeFixtureDir, '.ignore'), 'tmp-ignore/')
    await fsp.writeFile(path.join(homeFixtureDir, 'src', 'commands', 'files.ts'), 'export {}')
    await fsp.writeFile(path.join(homeFixtureDir, 'src', 'commands', 'files', 'index.ts'), 'export {}')
    await fsp.writeFile(path.join(homeFixtureDir, 'src', 'constants', 'fileSearch.ts'), 'export {}')
    await fsp.writeFile(path.join(homeFixtureDir, 'src', 'hooks', 'useFileSearch.ts'), 'export {}')
    await fsp.writeFile(path.join(homeFixtureDir, 'desktop', 'src', 'main.ts'), 'export {}')
    await fsp.writeFile(path.join(homeFixtureDir, 'scripts', 'quality-gate', 'baseline', 'fixtures', 'cross-module-refactor', 'src', 'index.ts'), 'export {}')
    await fsp.writeFile(path.join(homeFixtureDir, '__pycache__', 'fileSearch.cpython-311.pyc'), '')
    await fsp.writeFile(path.join(homeFixtureDir, 'node_modules', 'pkg', 'files.js'), '')
    await fsp.writeFile(path.join(homeFixtureDir, '.venv', 'lib', 'files.py'), '')
    await fsp.writeFile(path.join(homeFixtureDir, 'tmp-ignore', 'files.tmp'), '')

    const res = await handleFilesystemRoute(
      '/api/filesystem/browse',
      makeUrl('/api/filesystem/browse', {
        path: homeFixtureDir,
        search: 'files',
        includeFiles: 'true',
      }),
    )

    expect(res.status).toBe(200)
    const body = await res.json() as { entries: Array<{ name: string; relativePath?: string; isDirectory: boolean }> }
    expect(body.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'files.ts',
        relativePath: 'src/commands/files.ts',
        isDirectory: false,
      }),
    ]))
    expect(body.entries.some((entry) => entry.relativePath === 'src/constants/fileSearch.ts')).toBe(true)
    expect(body.entries.find((entry) => entry.relativePath === 'src/commands/files')?.isDirectory).toBe(true)
    expect(body.entries.some((entry) => entry.relativePath === '__pycache__/fileSearch.cpython-311.pyc')).toBe(false)
    expect(body.entries.some((entry) => entry.relativePath === 'node_modules/pkg/files.js')).toBe(false)
    expect(body.entries.some((entry) => entry.relativePath === '.venv/lib/files.py')).toBe(false)
    expect(body.entries.some((entry) => entry.relativePath === 'tmp-ignore/files.tmp')).toBe(false)

    const srcRes = await handleFilesystemRoute(
      '/api/filesystem/browse',
      makeUrl('/api/filesystem/browse', {
        path: homeFixtureDir,
        search: 'src',
        includeFiles: 'true',
      }),
    )

    expect(srcRes.status).toBe(200)
    const srcBody = await srcRes.json() as { entries: Array<{ relativePath?: string }> }
    const srcPaths = srcBody.entries.map(entry => entry.relativePath)
    expect(srcPaths[0]).toBe('src')
    expect(srcPaths.indexOf('src/hooks')).toBeGreaterThan(-1)
    expect(srcPaths.indexOf('desktop/src')).toBeGreaterThan(-1)
    expect(srcPaths.indexOf('scripts/quality-gate/baseline/fixtures/cross-module-refactor/src')).toBeGreaterThan(-1)
    expect(srcPaths.indexOf('src/hooks')).toBeLessThan(srcPaths.indexOf('desktop/src'))
    expect(srcPaths.indexOf('src/hooks')).toBeLessThan(srcPaths.indexOf('scripts/quality-gate/baseline/fixtures/cross-module-refactor/src'))
  })

  it('falls back to ripgrep search outside git and still respects ignore files', async () => {
    const homeFixtureDir = await fsp.mkdtemp(path.join(os.homedir(), 'claude-filesystem-test-'))
    cleanupDirs.add(homeFixtureDir)
    await fsp.mkdir(path.join(homeFixtureDir, 'app'), { recursive: true })
    await fsp.mkdir(path.join(homeFixtureDir, 'node_modules', 'pkg'), { recursive: true })
    await fsp.writeFile(path.join(homeFixtureDir, '.gitignore'), 'node_modules/')
    await fsp.writeFile(path.join(homeFixtureDir, 'app', 'cache-result.ts'), 'export {}')
    await fsp.writeFile(path.join(homeFixtureDir, 'node_modules', 'pkg', 'cache-result.js'), '')

    const res = await handleFilesystemRoute(
      '/api/filesystem/browse',
      makeUrl('/api/filesystem/browse', {
        path: homeFixtureDir,
        search: 'cache',
        includeFiles: 'true',
      }),
    )

    expect(res.status).toBe(200)
    const body = await res.json() as { entries: Array<{ relativePath?: string; isDirectory: boolean }> }
    expect(body.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        relativePath: 'app/cache-result.ts',
        isDirectory: false,
      }),
    ]))
    expect(body.entries.some((entry) => entry.relativePath === 'node_modules/pkg/cache-result.js')).toBe(false)
  })

  it('accepts /private/tmp aliases on macOS for browsing and file serving', async () => {
    if (process.platform !== 'darwin') return

    const tmpFixtureDir = await fsp.mkdtemp('/tmp/claude-filesystem-test-')
    cleanupDirs.add(tmpFixtureDir)
    const canonicalTmpDir = fs.realpathSync(tmpFixtureDir)
    const imagePath = path.join(canonicalTmpDir, 'preview.png')
    await fsp.writeFile(
      imagePath,
      Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c49444154789c63606060000000040001f61738550000000049454e44ae426082', 'hex'),
    )

    const browseRes = await handleFilesystemRoute(
      '/api/filesystem/browse',
      makeUrl('/api/filesystem/browse', {
        path: canonicalTmpDir,
        includeFiles: 'true',
      }),
    )
    expect(browseRes.status).toBe(200)
    const browseBody = await browseRes.json() as { entries: Array<{ name: string }> }
    expect(browseBody.entries.some((entry) => entry.name === 'preview.png')).toBe(true)

    const fileRes = await handleFilesystemRoute(
      '/api/filesystem/file',
      makeUrl('/api/filesystem/file', {
        path: imagePath,
      }),
    )
    expect(fileRes.status).toBe(200)
    expect(fileRes.headers.get('Content-Type')).toBe('image/png')
  })
})
