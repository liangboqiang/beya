/**
 * Unit tests for TaskService and Tasks API
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as os from 'os'
import { TaskService } from '../services/taskService.js'

// ============================================================================
// TaskService unit tests
// ============================================================================

describe('TaskService', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-tasks-'))
    process.env.BEYA_CONFIG_DIR = tmpDir
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
    delete process.env.BEYA_CONFIG_DIR
  })

  it('should return empty list when no tasks dir', async () => {
    const svc = new TaskService()
    const tasks = await svc.listTasks()
    expect(tasks).toEqual([])
  })

  it('should list tasks from JSON files', async () => {
    const tasksDir = path.join(tmpDir, 'tasks', 'session-1')
    await fs.mkdir(tasksDir, { recursive: true })

    await fs.writeFile(path.join(tasksDir, '1.json'), JSON.stringify({
      id: '1',
      subject: 'Review PR #42',
      status: 'completed',
      description: 'Review PR #42',
      createdAt: Date.now() - 60000,
      completedAt: Date.now(),
    }))

    await fs.writeFile(path.join(tasksDir, '2.json'), JSON.stringify({
      id: '2',
      subject: 'Frontend work',
      status: 'in_progress',
      owner: 'frontend-dev',
      createdAt: Date.now(),
    }))

    const svc = new TaskService()
    const tasks = await svc.listTasks()
    expect(tasks.length).toBe(2)
    // TaskService V2 sorts tasks by numeric task id within a task list.
    expect(tasks[0].id).toBe('1')
    expect(tasks[1].id).toBe('2')
    expect(tasks[0].taskListId).toBe('session-1')
  })

  it('should scan nested team task directories', async () => {
    const teamDir = path.join(tmpDir, 'tasks', 'my-team')
    await fs.mkdir(teamDir, { recursive: true })

    await fs.writeFile(path.join(teamDir, 'member-1.json'), JSON.stringify({
      id: '1',
      subject: 'Team task',
      status: 'completed',
      owner: 'member-1',
    }))

    const svc = new TaskService()
    const tasks = await svc.listTasks()
    expect(tasks.length).toBe(1)
    expect(tasks[0].taskListId).toBe('my-team')
  })

  it('should get single task by ID', async () => {
    const tasksDir = path.join(tmpDir, 'tasks', 'session-1')
    await fs.mkdir(tasksDir, { recursive: true })

    await fs.writeFile(path.join(tasksDir, 'abc.json'), JSON.stringify({
      id: 'abc',
      subject: 'build',
      status: 'pending',
    }))

    const svc = new TaskService()
    const task = await svc.getTask('session-1', 'abc')
    expect(task).toBeDefined()
    expect(task!.status).toBe('pending')
  })

  it('should return null for unknown task', async () => {
    const svc = new TaskService()
    const task = await svc.getTask('missing-list', 'nonexistent')
    expect(task).toBeNull()
  })

  it('should skip invalid JSON files gracefully', async () => {
    const tasksDir = path.join(tmpDir, 'tasks', 'session-1')
    await fs.mkdir(tasksDir, { recursive: true })
    await fs.writeFile(path.join(tasksDir, 'bad.json'), 'not json {{{')

    const svc = new TaskService()
    const tasks = await svc.listTasks()
    expect(tasks).toEqual([])
  })
})

// ============================================================================
// Tasks API integration tests
// ============================================================================

describe('Tasks API', () => {
  let server: any
  let baseUrl: string
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-tasks-api-'))
    process.env.BEYA_CONFIG_DIR = tmpDir
    await fs.mkdir(path.join(tmpDir, 'projects'), { recursive: true })

    const port = 15500 + Math.floor(Math.random() * 500)
    const { startServer } = await import('../../server/index.js')
    server = startServer(port, '127.0.0.1')
    baseUrl = `http://127.0.0.1:${port}`
  })

  afterEach(async () => {
    server?.stop()
    await fs.rm(tmpDir, { recursive: true, force: true })
    delete process.env.BEYA_CONFIG_DIR
  })

  it('should return empty tasks list', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`)
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.tasks).toEqual([])
  })

  it('should return tasks when files exist', async () => {
    const tasksDir = path.join(tmpDir, 'tasks', 'session-1')
    await fs.mkdir(tasksDir, { recursive: true })
    await fs.writeFile(path.join(tasksDir, 'test.json'), JSON.stringify({
      id: 'test', subject: 'test-task', status: 'completed',
    }))

    const res = await fetch(`${baseUrl}/api/tasks`)
    const data = await res.json()
    expect(data.tasks.length).toBe(1)
    expect(data.tasks[0].subject).toBe('test-task')
    expect(data.tasks[0].taskListId).toBe('session-1')
  })

  it('should return 404 for unknown task', async () => {
    const res = await fetch(`${baseUrl}/api/tasks/nonexistent`)
    expect(res.status).toBe(404)
  })

  it('should reject non-GET methods', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, { method: 'POST' })
    expect(res.status).toBe(405)
  })
})
