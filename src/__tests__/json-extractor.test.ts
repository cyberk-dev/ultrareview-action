import { test, expect, describe } from 'bun:test'
import { extractJsonArray } from '../agent/json-extractor.ts'

describe('json-extractor', () => {
  test('direct JSON parse', () => {
    const response = '[{"id": 1, "name": "test"}]'
    const result = extractJsonArray<{ id: number; name: string }>(response)
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe(1)
    expect(result[0]?.name).toBe('test')
  })

  test('extract from markdown code fence with json label', () => {
    const response = `Here's the JSON:
\`\`\`json
[{"id": 1}, {"id": 2}]
\`\`\``

    const result = extractJsonArray<{ id: number }>(response)
    expect(result).toHaveLength(2)
    expect(result[0]?.id).toBe(1)
    expect(result[1]?.id).toBe(2)
  })

  test('extract from markdown code fence without json label', () => {
    const response = `Here's the JSON:
\`\`\`
[{"value": "a"}, {"value": "b"}]
\`\`\``

    const result = extractJsonArray<{ value: string }>(response)
    expect(result).toHaveLength(2)
    expect(result[0]?.value).toBe('a')
    expect(result[1]?.value).toBe('b')
  })

  test('extract from embedded brackets', () => {
    const response = `Some text before [{"item": 1}] and text after`
    const result = extractJsonArray<{ item: number }>(response)
    expect(result).toHaveLength(1)
    expect(result[0]?.item).toBe(1)
  })

  test('invalid JSON returns empty array', () => {
    const response = '{ invalid json }'
    const result = extractJsonArray(response)
    expect(result).toEqual([])
  })

  test('non-array JSON returns empty array', () => {
    const response = '{"key": "value"}'
    const result = extractJsonArray(response)
    expect(result).toEqual([])
  })

  test('empty string returns empty array', () => {
    const result = extractJsonArray('')
    expect(result).toEqual([])
  })

  test('whitespace only returns empty array', () => {
    const result = extractJsonArray('   \n\n   ')
    expect(result).toEqual([])
  })

  test('complex nested objects', () => {
    const response = `[
      {"id": 1, "nested": {"key": "value"}},
      {"id": 2, "nested": {"key": "value2"}}
    ]`
    const result = extractJsonArray<any>(response)
    expect(result).toHaveLength(2)
    expect(result[0]?.nested.key).toBe('value')
    expect(result[1]?.nested.key).toBe('value2')
  })

  test('array with strings', () => {
    const response = '["hello", "world", "test"]'
    const result = extractJsonArray<string>(response)
    expect(result).toHaveLength(3)
    expect(result[0]).toBe('hello')
    expect(result[2]).toBe('test')
  })

  test('array with numbers', () => {
    const response = '[1, 2, 3, 4, 5]'
    const result = extractJsonArray<number>(response)
    expect(result).toHaveLength(5)
    expect(result[0]).toBe(1)
    expect(result[4]).toBe(5)
  })

  test('markdown fence with trailing text', () => {
    const response = `\`\`\`json
[{"test": true}]
\`\`\`
More text after`
    const result = extractJsonArray<{ test: boolean }>(response)
    expect(result).toHaveLength(1)
    expect(result[0]?.test).toBe(true)
  })

  test('markdown fence with leading text', () => {
    const response = `Some text before
\`\`\`json
[{"id": 123}]
\`\`\``
    const result = extractJsonArray<{ id: number }>(response)
    expect(result).toHaveLength(1)
    expect(result[0]?.id).toBe(123)
  })

  test('multiple brackets extracts first-last pair', () => {
    const response = 'Start [{"a": 1}, {"b": 2}] end'
    const result = extractJsonArray<any>(response)
    // Should extract from first [ to last ]
    expect(result).toHaveLength(2)
    expect(result[0]?.a).toBe(1)
    expect(result[1]?.b).toBe(2)
  })

  test('empty array', () => {
    const response = '[]'
    const result = extractJsonArray(response)
    expect(result).toEqual([])
  })

  test('array with null values', () => {
    const response = '[{"key": null}, {"key": "value"}]'
    const result = extractJsonArray<{ key: string | null }>(response)
    expect(result).toHaveLength(2)
    expect(result[0]?.key).toBeNull()
    expect(result[1]?.key).toBe('value')
  })
})
