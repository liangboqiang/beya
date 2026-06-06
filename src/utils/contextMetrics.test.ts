import { afterEach, describe, expect, it } from 'bun:test'
import { logContextMetrics } from './api.js'

const originalNodeEnv = process.env.NODE_ENV

afterEach(() => {
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV
  } else {
    process.env.NODE_ENV = originalNodeEnv
  }
})

describe('context metrics logging', () => {
  it('does not throw when metric collection cannot load runtime context', async () => {
    process.env.NODE_ENV = 'development'

    await expect(logContextMetrics({}, undefined as any)).resolves.toBeUndefined()
  })
})
