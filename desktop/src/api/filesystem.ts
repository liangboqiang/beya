import { api } from './client'

type DirEntry = {
  name: string
  path: string
  isDirectory: boolean
  relativePath?: string
}

type BrowseResult = {
  currentPath: string
  parentPath: string
  entries: DirEntry[]
  query?: string
}

type PickDirectoryResult = {
  selectedPath: string | null
}

type RegisterDirectoryResult = {
  selectedPath: string
}

export const filesystemApi = {
  browse(path?: string, options?: { includeFiles?: boolean }) {
    const q = new URLSearchParams()
    if (path) q.set('path', path)
    if (options?.includeFiles) q.set('includeFiles', 'true')
    const qs = q.toString()
    return api.get<BrowseResult>(`/filesystem/browse${qs ? `?${qs}` : ''}`)
  },

  search(query: string, cwd?: string) {
    const q = new URLSearchParams({ search: query, maxResults: '200', includeFiles: 'true' })
    if (cwd) q.set('path', cwd)
    return api.get<BrowseResult>(`/filesystem/browse?${q}`)
  },

  pickDirectory(initialPath?: string) {
    return api.post<PickDirectoryResult>(
      '/filesystem/pick-directory',
      { initialPath },
      { timeout: 10 * 60_000 },
    )
  },

  registerDirectory(path: string) {
    return api.post<RegisterDirectoryResult>(
      '/filesystem/register-directory',
      { path },
    )
  },
}
