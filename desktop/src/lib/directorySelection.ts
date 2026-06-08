import { filesystemApi } from '../api/filesystem'
import { getServerBaseUrl, isTauriRuntime, requiresH5AuthForServerUrl } from './desktopRuntime'

type SelectDirectoryOptions = {
  title?: string
  initialPath?: string
}

export type DirectorySelectionResult =
  | { kind: 'selected'; path: string }
  | { kind: 'cancelled' }
  | { kind: 'unavailable'; error?: unknown }

function normalizeDialogSelection(selected: string | string[] | null): string | null {
  if (!selected) return null
  const selectedPath = Array.isArray(selected) ? selected[0] : selected
  if (typeof selectedPath !== 'string') return null
  const trimmed = selectedPath.trim()
  return trimmed || null
}

function canUseLocalServerDirectoryPicker() {
  try {
    return !requiresH5AuthForServerUrl(getServerBaseUrl())
  } catch {
    return false
  }
}

async function selectTauriDirectory(options: SelectDirectoryOptions): Promise<DirectorySelectionResult> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({
      directory: true,
      multiple: false,
      title: options.title,
      defaultPath: options.initialPath || undefined,
    })
    const selectedPath = normalizeDialogSelection(selected)
    if (!selectedPath) {
      return { kind: 'cancelled' }
    }

    await filesystemApi.registerDirectory(selectedPath).catch(() => undefined)
    return { kind: 'selected', path: selectedPath }
  } catch (error) {
    return { kind: 'unavailable', error }
  }
}

async function selectServerDirectory(options: SelectDirectoryOptions): Promise<DirectorySelectionResult> {
  if (!canUseLocalServerDirectoryPicker()) {
    return { kind: 'unavailable' }
  }

  try {
    const result = await filesystemApi.pickDirectory(options.initialPath)
    return result.selectedPath
      ? { kind: 'selected', path: result.selectedPath }
      : { kind: 'cancelled' }
  } catch (error) {
    return { kind: 'unavailable', error }
  }
}

export async function selectDirectory(options: SelectDirectoryOptions = {}): Promise<DirectorySelectionResult> {
  if (isTauriRuntime()) {
    const tauriResult = await selectTauriDirectory(options)
    if (tauriResult.kind !== 'unavailable') {
      return tauriResult
    }
  }

  return selectServerDirectory(options)
}
