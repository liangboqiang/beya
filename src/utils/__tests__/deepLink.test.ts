import { describe, expect, test } from 'bun:test'
import {
  buildDeepLink,
  DEEP_LINK_PROTOCOL,
  parseDeepLink,
} from '../deepLink/parseDeepLink.js'

describe('deep link parsing', () => {
  test('builds canonical Beya deep links', () => {
    const link = buildDeepLink({
      query: 'fix tests',
      cwd: '/workspace/project',
      repo: 'owner/repo',
    })

    expect(link.startsWith(`${DEEP_LINK_PROTOCOL}://open?`)).toBe(true)
    expect(link).toContain('q=fix+tests')
    expect(parseDeepLink(link)).toEqual({
      query: 'fix tests',
      cwd: '/workspace/project',
      repo: 'owner/repo',
      deprecatedAlias: undefined,
    })
  })

  test('accepts deprecated legacy deep link aliases', () => {
    expect(parseDeepLink('claude-cli://open?q=hello')).toEqual({
      query: 'hello',
      cwd: undefined,
      repo: undefined,
      deprecatedAlias: true,
    })
  })

  test('rejects unknown deep link schemes', () => {
    expect(() => parseDeepLink('other-cli://open?q=hello')).toThrow(
      'expected beya-cli:// scheme',
    )
  })
})
