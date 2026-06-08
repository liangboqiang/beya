import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isTauriRuntime: false,
  serverBaseUrl: 'http://127.0.0.1:3456',
  dialogOpen: vi.fn(),
  pickDirectory: vi.fn(),
  registerDirectory: vi.fn(),
}))

vi.mock('./desktopRuntime', () => ({
  getServerBaseUrl: () => mocks.serverBaseUrl,
  isTauriRuntime: () => mocks.isTauriRuntime,
  requiresH5AuthForServerUrl: (serverUrl: string) => {
    const hostname = new URL(serverUrl).hostname
    return hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '[::1]'
  },
}))

vi.mock('../api/filesystem', () => ({
  filesystemApi: {
    pickDirectory: mocks.pickDirectory,
    registerDirectory: mocks.registerDirectory,
  },
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: mocks.dialogOpen,
}))

import { selectDirectory } from './directorySelection'

describe('selectDirectory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isTauriRuntime = false
    mocks.serverBaseUrl = 'http://127.0.0.1:3456'
    mocks.registerDirectory.mockResolvedValue({ selectedPath: '/workspace/project' })
  })

  it('uses the Tauri directory dialog in the desktop runtime', async () => {
    mocks.isTauriRuntime = true
    mocks.dialogOpen.mockResolvedValueOnce('C:\\workspace\\project')

    await expect(selectDirectory({
      title: 'Choose project folder',
      initialPath: 'C:\\workspace',
    })).resolves.toEqual({
      kind: 'selected',
      path: 'C:\\workspace\\project',
    })

    expect(mocks.dialogOpen).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      title: 'Choose project folder',
      defaultPath: 'C:\\workspace',
    })
    expect(mocks.registerDirectory).toHaveBeenCalledWith('C:\\workspace\\project')
    expect(mocks.pickDirectory).not.toHaveBeenCalled()
  })

  it('does not mask a Tauri selection when server-side root registration fails', async () => {
    mocks.isTauriRuntime = true
    mocks.dialogOpen.mockResolvedValueOnce('C:\\workspace\\project')
    mocks.registerDirectory.mockRejectedValueOnce(new Error('server not ready'))

    await expect(selectDirectory()).resolves.toEqual({
      kind: 'selected',
      path: 'C:\\workspace\\project',
    })
  })

  it('treats a cancelled Tauri directory dialog as a cancellation', async () => {
    mocks.isTauriRuntime = true
    mocks.dialogOpen.mockResolvedValueOnce(null)

    await expect(selectDirectory()).resolves.toEqual({ kind: 'cancelled' })
    expect(mocks.pickDirectory).not.toHaveBeenCalled()
  })

  it('falls back to the local server picker when the Tauri dialog API is unavailable', async () => {
    mocks.isTauriRuntime = true
    mocks.dialogOpen.mockRejectedValueOnce(new Error('dialog plugin unavailable'))
    mocks.pickDirectory.mockResolvedValueOnce({ selectedPath: 'C:\\workspace\\fallback' })

    await expect(selectDirectory({ initialPath: 'C:\\workspace' })).resolves.toEqual({
      kind: 'selected',
      path: 'C:\\workspace\\fallback',
    })

    expect(mocks.pickDirectory).toHaveBeenCalledWith('C:\\workspace')
  })

  it('uses the local server picker for the browser Web UI on loopback', async () => {
    mocks.pickDirectory.mockResolvedValueOnce({ selectedPath: '/workspace/project' })

    await expect(selectDirectory({ initialPath: '/workspace' })).resolves.toEqual({
      kind: 'selected',
      path: '/workspace/project',
    })

    expect(mocks.pickDirectory).toHaveBeenCalledWith('/workspace')
  })

  it('does not ask a remote H5 server to open an interactive folder dialog', async () => {
    mocks.serverBaseUrl = 'http://192.168.0.5:3456'

    await expect(selectDirectory()).resolves.toEqual({ kind: 'unavailable' })
    expect(mocks.pickDirectory).not.toHaveBeenCalled()
  })
})
