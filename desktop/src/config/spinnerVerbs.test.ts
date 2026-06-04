import { describe, expect, it } from 'vitest'
import { randomSpinnerVerb } from './spinnerVerbs'

describe('randomSpinnerVerb', () => {
  it('uses a translatable stable verb outside English locale', () => {
    expect(randomSpinnerVerb('zh')).toBe('Thinking')
  })

  it('keeps English spinner copy for English locale', () => {
    expect(randomSpinnerVerb('en')).toMatch(/\S/)
  })
})
