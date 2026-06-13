import { api } from './client'
import type { CronTask, CreateTaskInput, TaskRun } from '../types/task'

type TasksResponse = { tasks: CronTask[] }
type TaskResponse = { task: CronTask }
type RunsResponse = { runs: TaskRun[] }

export const tasksApi = {
  list() {
    return api.get<TasksResponse>('/scheduled-tasks')
  },

  create(input: CreateTaskInput) {
    return api.post<TaskResponse>('/scheduled-tasks', input)
  },

  update(id: string, updates: Partial<CronTask>) {
    return api.put<TaskResponse>(`/scheduled-tasks/${id}`, updates)
  },

  delete(id: string) {
    return api.delete<{ ok: true }>(`/scheduled-tasks/${id}`)
  },

  runTask(id: string) {
    return api.post<{ ok: true }>(`/scheduled-tasks/${id}/run`, {})
  },

  getRecentRuns(limit = 50) {
    return api.get<RunsResponse>(`/scheduled-tasks/runs?limit=${limit}`)
  },

  getTaskRuns(taskId: string) {
    return api.get<RunsResponse>(`/scheduled-tasks/${taskId}/runs`)
  },
}
