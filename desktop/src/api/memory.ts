import { api } from './client'
import type { MemoryFile, MemoryFileDetail, MemoryProject } from '../types/memory'

export const memoryApi = {
  listProjects: (cwd?: string) => {
    const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
    return api.get<{ projects: MemoryProject[] }>(`/memory/projects${query}`)
  },

  listFiles: (projectId: string) => {
    const query = new URLSearchParams({ projectId })
    return api.get<{ files: MemoryFile[] }>(`/memory/files?${query.toString()}`)
  },

  readFile: (projectId: string, path: string) => {
    const query = new URLSearchParams({ projectId, path })
    return api.get<{ file: MemoryFileDetail }>(`/memory/file?${query.toString()}`)
  },

  saveFile: (input: { projectId: string; path: string; content: string }) =>
    api.put<{ ok: true; file: Omit<MemoryFileDetail, 'content'> }>('/memory/file', input),
}
