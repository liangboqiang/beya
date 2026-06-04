import { productionDeps, type QueryDeps } from '../query/deps.js'
import { ProviderService } from '../server/services/providerService.js'
import type { SavedProvider } from '../server/types/provider.js'
import { gatewayModels } from './models.js'
import type { GatewayProviderRef, ResolvedModelTransport } from './types.js'

const providerService = new ProviderService()

let providerEnvLock: Promise<void> = Promise.resolve()

export async function resolveGatewayModelTransport({
  provider,
  model,
}: {
  provider?: GatewayProviderRef
  model?: string
}): Promise<ResolvedModelTransport> {
  const deps = productionDeps()

  if (!provider) {
    return {
      deps,
      model: gatewayModels.resolve(model),
    }
  }

  const providerId = typeof provider === 'string' ? provider : provider.id
  const savedProvider = await providerService.getProvider(providerId)
  const runtimeEnv = await providerService.getProviderRuntimeEnv(providerId)

  return {
    deps: {
      ...deps,
      callModel: async function* gatewayProviderCallModel(params) {
        yield* withProviderEnv(runtimeEnv, () => deps.callModel(params))
      },
    },
    model: model ?? primaryModel(savedProvider) ?? gatewayModels.resolve(undefined),
    providerId,
  }
}

function primaryModel(provider: SavedProvider): string | undefined {
  const model = provider.modelRoles?.primary
  return model?.trim() || undefined
}

async function* withProviderEnv<T>(
  env: Record<string, string>,
  run: () => AsyncGenerator<T, void>,
): AsyncGenerator<T, void> {
  const previousLock = providerEnvLock
  let release!: () => void
  providerEnvLock = new Promise<void>(resolve => {
    release = resolve
  })
  await previousLock

  const previousValues = new Map<string, string | undefined>()
  for (const [key, value] of Object.entries(env)) {
    previousValues.set(key, process.env[key])
    process.env[key] = value
  }

  try {
    yield* run()
  } finally {
    for (const [key, previous] of previousValues) {
      if (previous === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = previous
      }
    }
    release()
  }
}
