import type { EffortLevel } from './settings'

export type RuntimeSelection = {
  kind?: 'provider' | 'local_cli'
  providerId: string | null
  localCliId?: string | null
  modelId: string
  effortLevel?: EffortLevel
}
