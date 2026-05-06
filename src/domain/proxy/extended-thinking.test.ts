import { describe, expect, it } from 'vitest'
import { applyThinkingAndEffort, isAdaptiveThinkingModel } from './extended-thinking'
import type { AnthropicRequestBody } from './types'

function makeBody(overrides: Partial<AnthropicRequestBody> = {}): AnthropicRequestBody {
  return { model: 'claude-sonnet-4-6', messages: [], ...overrides }
}

describe('isAdaptiveThinkingModel', () => {
  const adaptiveModels = [
    'claude-opus-4-6',
    'claude-opus-4-6-20251101',
    'claude-sonnet-4-6',
    'claude-sonnet-4-6-20251101',
    'claude-opus-4-7',
    'claude-opus-4-7-20260101',
    'claude-mythos-4-7',
  ]
  const legacyModels = [
    'claude-sonnet-4-5',
    'claude-opus-4-5',
    'claude-haiku-4-5',
    'claude-haiku-4-6',
  ]

  for (const id of adaptiveModels) {
    it(`returns true for ${id}`, () => {
      expect(isAdaptiveThinkingModel(id)).toBe(true)
    })
  }

  for (const id of legacyModels) {
    it(`returns false for ${id}`, () => {
      expect(isAdaptiveThinkingModel(id)).toBe(false)
    })
  }
})

describe('applyThinkingAndEffort — no signals', () => {
  it('leaves body unchanged when both thinking and effort are absent', () => {
    const body = makeBody()
    applyThinkingAndEffort(body, {
      canonicalId: 'claude-sonnet-4-6',
      thinking: false,
      effort: null,
    })
    expect(body.thinking).toBeUndefined()
    expect(body.output_config).toBeUndefined()
  })
})

describe('applyThinkingAndEffort — 4.6 / 4.7 models', () => {
  it('sets adaptive thinking for 4.6 model', () => {
    const body = makeBody({ model: 'claude-sonnet-4-6' })
    applyThinkingAndEffort(body, {
      canonicalId: 'claude-sonnet-4-6',
      thinking: true,
      effort: null,
    })
    expect(body.thinking).toEqual({ type: 'adaptive' })
    expect(body.output_config).toBeUndefined()
  })

  it('sets adaptive thinking + effort for 4.6 model with xhigh', () => {
    const body = makeBody({ model: 'claude-sonnet-4-6' })
    applyThinkingAndEffort(body, {
      canonicalId: 'claude-sonnet-4-6',
      thinking: true,
      effort: 'xhigh',
    })
    expect(body.thinking).toEqual({ type: 'adaptive' })
    expect(body.output_config).toEqual({ effort: 'xhigh' })
  })

  it('sets only effort without thinking for 4.6 model (medium, no thinking flag)', () => {
    const body = makeBody({ model: 'claude-sonnet-4-6' })
    applyThinkingAndEffort(body, {
      canonicalId: 'claude-sonnet-4-6',
      thinking: false,
      effort: 'medium',
    })
    expect(body.thinking).toBeUndefined()
    expect(body.output_config).toEqual({ effort: 'medium' })
  })

  it('sets adaptive thinking for opus-4-7', () => {
    const body = makeBody({ model: 'claude-opus-4-7' })
    applyThinkingAndEffort(body, {
      canonicalId: 'claude-opus-4-7',
      thinking: true,
      effort: 'max',
    })
    expect(body.thinking).toEqual({ type: 'adaptive' })
    expect(body.output_config).toEqual({ effort: 'max' })
  })
})

describe('applyThinkingAndEffort — 4.5 / older models', () => {
  it('sets enabled thinking with default budget when no effort given', () => {
    const body = makeBody({ model: 'claude-sonnet-4-5' })
    applyThinkingAndEffort(body, {
      canonicalId: 'claude-sonnet-4-5',
      thinking: true,
      effort: null,
    })
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 16_000 })
    expect(body.output_config).toBeUndefined()
  })

  it('maps low effort to budget_tokens=4000', () => {
    const body = makeBody({ model: 'claude-sonnet-4-5' })
    applyThinkingAndEffort(body, {
      canonicalId: 'claude-sonnet-4-5',
      thinking: true,
      effort: 'low',
    })
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 4_000 })
    expect(body.output_config).toEqual({ effort: 'low' })
  })

  it('maps medium effort to budget_tokens=8000', () => {
    const body = makeBody({ model: 'claude-sonnet-4-5' })
    applyThinkingAndEffort(body, {
      canonicalId: 'claude-sonnet-4-5',
      thinking: true,
      effort: 'medium',
    })
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 8_000 })
  })

  it('maps high effort to budget_tokens=16000', () => {
    const body = makeBody({ model: 'claude-opus-4-5' })
    applyThinkingAndEffort(body, {
      canonicalId: 'claude-opus-4-5',
      thinking: true,
      effort: 'high',
    })
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 16_000 })
  })

  it('maps xhigh effort to budget_tokens=32000', () => {
    const body = makeBody({ model: 'claude-sonnet-4-5' })
    applyThinkingAndEffort(body, {
      canonicalId: 'claude-sonnet-4-5',
      thinking: true,
      effort: 'xhigh',
    })
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 32_000 })
    expect(body.output_config).toEqual({ effort: 'xhigh' })
  })

  it('maps max effort to budget_tokens=64000', () => {
    const body = makeBody({ model: 'claude-sonnet-4-5' })
    applyThinkingAndEffort(body, {
      canonicalId: 'claude-sonnet-4-5',
      thinking: true,
      effort: 'max',
    })
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 64_000 })
    expect(body.output_config).toEqual({ effort: 'max' })
  })
})

describe('applyThinkingAndEffort — merge / preservation', () => {
  it('preserves pre-existing output_config keys when adding effort', () => {
    const body = makeBody({
      model: 'claude-sonnet-4-6',
      output_config: { some_existing_key: true },
    })
    applyThinkingAndEffort(body, {
      canonicalId: 'claude-sonnet-4-6',
      thinking: false,
      effort: 'high',
    })
    expect(body.output_config).toEqual({ some_existing_key: true, effort: 'high' })
  })

  it('overwrites a pre-existing thinking when thinking flag is set', () => {
    const body = makeBody({
      model: 'claude-sonnet-4-6',
      thinking: { type: 'disabled' },
    })
    applyThinkingAndEffort(body, {
      canonicalId: 'claude-sonnet-4-6',
      thinking: true,
      effort: null,
    })
    expect(body.thinking).toEqual({ type: 'adaptive' })
  })

  it('does NOT overwrite pre-existing thinking when thinking flag is false', () => {
    const existing = { type: 'adaptive' }
    const body = makeBody({
      model: 'claude-sonnet-4-6',
      thinking: existing,
    })
    applyThinkingAndEffort(body, {
      canonicalId: 'claude-sonnet-4-6',
      thinking: false,
      effort: null,
    })
    expect(body.thinking).toEqual({ type: 'adaptive' })
  })

  it('treats output_config array as a non-object and replaces it', () => {
    const body = makeBody({
      model: 'claude-sonnet-4-6',
      output_config: ['unexpected', 'array'],
    })
    applyThinkingAndEffort(body, {
      canonicalId: 'claude-sonnet-4-6',
      thinking: false,
      effort: 'medium',
    })
    expect(body.output_config).toEqual({ effort: 'medium' })
  })
})
