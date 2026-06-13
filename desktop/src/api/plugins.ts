import { api } from './client'
import type {
  PluginDetail,
  PluginListResponse,
  PluginReloadSummary,
  PluginSessionReloadSummary,
  PluginScope,
} from '../types/plugin'

type PluginActionPayload = {
  id: string
  scope?: PluginScope
  keepData?: boolean
}

export const pluginsApi = {
  list: (cwd?: string) => {
    const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''
    return api.get<PluginListResponse>(`/plugins${query}`)
  },

  detail: (id: string, cwd?: string) => {
    const query = new URLSearchParams({ id })
    if (cwd) query.set('cwd', cwd)
    return api.get<{ detail: PluginDetail }>(`/plugins/${encodeURIComponent(id)}?${query.toString()}`)
  },

  enable: (payload: PluginActionPayload) =>
    api.post<{ ok: true; message: string }>('/plugins/enable', payload),

  disable: (payload: PluginActionPayload) =>
    api.post<{ ok: true; message: string }>('/plugins/disable', payload),

  update: (payload: PluginActionPayload) =>
    api.post<{ ok: true; message: string }>('/plugins/update', payload),

  uninstall: (payload: PluginActionPayload) =>
    api.post<{ ok: true; message: string }>('/plugins/uninstall', payload),

  reload: (cwd?: string, sessionId?: string) => {
    const query = new URLSearchParams()
    if (cwd) query.set('cwd', cwd)
    if (sessionId) query.set('sessionId', sessionId)
    const suffix = query.size > 0 ? `?${query.toString()}` : ''
    return api.post<{
      ok: true
      summary: PluginReloadSummary
      session?: PluginSessionReloadSummary
    }>(
      `/plugins/reload${suffix}`,
      undefined,
      { timeout: 120_000 },
    )
  },
}
