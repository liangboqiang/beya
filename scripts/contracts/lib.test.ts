import { describe, expect, it } from 'bun:test'
import {
  buildGeneratedModel,
  loadCapabilityFiles,
  loadContractFiles,
  loadExecutorFiles,
  loadModuleFiles,
  validateContracts,
} from './lib.js'

describe('contract codegen model', () => {
  it('builds a module-aware generated model without legacy RPC escape hatches', () => {
    const contracts = loadContractFiles()
    const modules = loadModuleFiles()
    const capabilities = loadCapabilityFiles()
    const executors = loadExecutorFiles()
    const errors = validateContracts(contracts, modules, capabilities, executors)

    expect(errors).toEqual([])

    const model = buildGeneratedModel(contracts, modules, capabilities, executors)
    expect(model.paths).toEqual({
      rpc: '/rpc',
      sessionLive: '/sessions/{sessionId}/live',
      sessionRuntime: '/sessions/{sessionId}/runtime',
    })
    expect(model.rpcMethods).not.toContain('resources.request')
    expect(model.modules.map((entry) => entry.id)).toContain('session-host')
    expect(model.modules.map((entry) => entry.id)).toContain('model-runtime')
    expect(model.executors.map((entry) => entry.id)).toContain('agent.runtime')
    expect(model.capabilities.map((entry) => entry.id)).toContain('capability.registry')
    expect(model.rpcResourceMethods.find((entry) => entry.name === 'sessions.create')).toMatchObject({
      owner: 'session-host',
      httpMethod: 'POST',
      path: '/sessions',
    })
  })
})
