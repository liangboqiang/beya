import { describe, expect, it } from 'bun:test'
import { parseRuntimeMetadata } from './runtimePluginTools.js'

describe('runtime plugin tool metadata', () => {
  it('parses object metadata from the runtime environment payload', () => {
    expect(parseRuntimeMetadata('{"user_id":"u1","conversation_id":"conv-1"}')).toEqual({
      user_id: 'u1',
      conversation_id: 'conv-1',
    })
  })

  it('ignores invalid or non-object metadata payloads', () => {
    expect(parseRuntimeMetadata('not json')).toEqual({})
    expect(parseRuntimeMetadata('["u1"]')).toEqual({})
    expect(parseRuntimeMetadata('"u1"')).toEqual({})
  })
})
