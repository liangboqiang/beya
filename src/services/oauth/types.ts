// @generated stub from scan-missing-imports (runtime-safe)
// This module is intentionally a no-op compatibility shim.
// It exports every name that the public source tree imports from it so ESM startup
// does not fail when optional/internal modules are absent.

const __target = function noop(..._args: any[]) {
  return undefined
}

const __handler: ProxyHandler<any> = {
  get(_target, prop) {
    if (prop === '__esModule') return true
    if (prop === 'default') return stub
    if (prop === Symbol.toPrimitive) return () => undefined
    if (prop === Symbol.iterator) return function* () {}
    if (prop === Symbol.asyncIterator) return async function* () {}
    if (prop === 'then') return undefined
    return stub
  },
  apply() {
    return stub
  },
  construct() {
    return stub
  },
}

const stub: any = new Proxy(__target, __handler)

export default stub
export const __stubMissing = true
export type BillingType = any
export type OAuthProfileResponse = any
export type OAuthTokenExchangeResponse = any
export type OAuthTokens = any
export type RateLimitTier = any
export type ReferralCampaign = any
export type ReferralEligibilityResponse = any
export type ReferralRedemptionsResponse = any
export type ReferrerRewardInfo = any
export type SubscriptionType = any
export type UserRolesResponse = any

export { stub as BillingType, stub as OAuthProfileResponse, stub as OAuthTokenExchangeResponse, stub as OAuthTokens, stub as RateLimitTier, stub as ReferralCampaign, stub as ReferralEligibilityResponse, stub as ReferralRedemptionsResponse, stub as ReferrerRewardInfo, stub as SubscriptionType, stub as UserRolesResponse }
