export type AgentRuntimeExecutorInput = Record<string, unknown>
export type AgentRuntimeExecutorOutput = Record<string, unknown>

export async function runAgentRuntimeExecutor(
  input: AgentRuntimeExecutorInput,
): Promise<AgentRuntimeExecutorOutput> {
  return {
    accepted: true,
    input,
    executor: 'agent.runtime',
  }
}
