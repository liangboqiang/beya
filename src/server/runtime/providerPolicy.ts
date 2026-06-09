import type { SavedProvider } from '../types/provider.js'
import type { ProviderRequestPolicy } from './protocol.js'

export type ProviderPolicyInput = Pick<SavedProvider, 'providerId' | 'baseUrl'>

export function resolveProviderRequestPolicy(
  provider: ProviderPolicyInput,
): ProviderRequestPolicy {
  const providerId = provider.providerId.toLowerCase()
  const baseUrl = provider.baseUrl.toLowerCase()
  const isDeepSeekCompatible =
    providerId === 'deepseek' ||
    /(^|[./-])deepseek([./-]|$)/i.test(baseUrl) ||
    /(^|[./-])opencode\.ai([:/]|$)/i.test(baseUrl)

  if (isDeepSeekCompatible) {
    return {
      imageMode: 'text_only',
      reasoningMode: 'native',
      usageTrust: 'high',
    }
  }

  if (providerId === 'qwen') {
    return {
      stripParams: [
        'thinking',
        'reasoning',
        'reasoning_content',
        'redacted_thinking',
        'reasoning_effort',
        'thinking_budget',
      ],
      imageMode: 'unsupported',
      reasoningMode: 'unsupported',
      usageTrust: 'medium',
    }
  }

  if (providerId === 'custom') {
    return {
      stripParams: [
        'thinking',
        'reasoning',
        'reasoning_content',
        'redacted_thinking',
        'reasoning_effort',
        'thinking_budget',
      ],
      imageMode: 'unsupported',
      reasoningMode: 'unsupported',
      usageTrust: 'low',
    }
  }

  return {
    imageMode: 'native',
    reasoningMode: 'native',
    usageTrust: 'high',
  }
}
