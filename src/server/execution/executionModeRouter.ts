import { localCliExecutionBackend } from './localCliExecutionBackend.js'
import { providerExecutionBackend } from './providerExecutionBackend.js'
import type {
  ExecutionBackend,
  ExecutionBackendHost,
  PreparedExecutionSessionStart,
} from './types.js'

export class ExecutionModeRouter {
  constructor(
    private readonly providerBackend: ExecutionBackend = providerExecutionBackend,
    private readonly localCliBackend: ExecutionBackend = localCliExecutionBackend,
  ) {}

  startSession(
    input: PreparedExecutionSessionStart,
    host: ExecutionBackendHost,
  ): Promise<void> {
    const backend = input.options?.executionMode === 'local_cli'
      ? this.localCliBackend
      : this.providerBackend
    return backend.startSession(input, host)
  }
}

export const executionModeRouter = new ExecutionModeRouter()
