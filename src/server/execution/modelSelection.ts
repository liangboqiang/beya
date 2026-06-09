import type { SelectedLocalCliRuntime } from '../services/localCliRuntimeService.js'

export function sanitizeModelArgument(value: string | undefined | null): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  if (trimmed.length > 200) return null
  if (!/^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/.test(trimmed)) return null
  return trimmed
}

export function resolveLocalCliStartupModel(
  runtime: SelectedLocalCliRuntime,
  requestedModel?: string | null,
): string | undefined {
  const requested = sanitizeModelArgument(requestedModel)
  if (requested) return requested
  const roleModel = runtime.modelRoles?.primary?.trim()
  if (roleModel) return roleModel
  return undefined
}
