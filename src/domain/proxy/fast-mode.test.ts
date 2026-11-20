import { describe, expect, it } from 'vitest'
import {
  FAST_MODE_BETA,
  applyFastMode,
  fastModeSupport,
  requestsFastMode,
} from './fast-mode'
import { transformRequest } from './transform-request'
import type { AnthropicRequestBody } from './types'

function body(extra: Record<string, unknown>): AnthropicRequestBody {
  return {
    model: 'claude-opus-5-5',
    messages: [{ role: 'user', content: 'hi' }],
    ...extra,
  }
}

describe('fastModeSupport', () => {
  it.each(['claude-opus-5-5', 'claude-fable-5-2', 'claude-mythos-5-2'])(
    '%s is GA (no beta header)',
    (id) => expect(fastModeSupport(id)).toBe('ga'),
  )
  it.each(['claude-opus-5', 'claude-opus-4-8'])('%s needs the beta header', (id) =>
    expect(fastModeSupport(id)).toBe('beta'),
  )
  it.each([
    'claude-sonnet-5-5',
    'claude-sonnet-4-6',
    'claude-haiku-5-5',
    'claude-opus-4-7',
    'claude-fable-5-1',
  ])('%s does not support fast mode', (id) => expect(fastModeSupport(id)).toBeNull())

  it('accepts dated snapshots', () => {
    expect(fastModeSupport('claude-opus-5-20260101')).toBe('beta')
  })
})

describe('requestsFastMode', () => {
  it.each([
    [{ service_tier: 'priority' }, true],
    [{ service_tier: 'fast' }, true],
    [{ service_tier: 'Priority' }, true],
    [{ speed: 'fast' }, true],
    [{ service_tier: 'default' }, false],
    [{ service_tier: 'auto' }, false],
    [{ speed: 'standard' }, false],
    [{}, false],
  ])('%j -> %s', (extra, expected) => {
    expect(requestsFastMode(body(extra))).toBe(expected)
  })
})

describe('applyFastMode', () => {
  it('maps Cursor service_tier=priority to speed=fast on a GA model', () => {
    const b = body({ service_tier: 'priority' })
    expect(applyFastMode(b)).toEqual({ fast: true, downgraded: false, betas: [] })
    expect(b.speed).toBe('fast')
  })

  it('adds the beta header for preview models', () => {
    const b = body({ model: 'claude-opus-5', service_tier: 'fast' })
    expect(applyFastMode(b).betas).toEqual([FAST_MODE_BETA])
  })

  it('downgrades (drops speed) on unsupported models instead of 400ing', () => {
    const b = body({ model: 'claude-sonnet-5-5', speed: 'fast' })
    expect(applyFastMode(b)).toEqual({ fast: false, downgraded: true, betas: [] })
    expect(b.speed).toBeUndefined()
  })
})

describe('transformRequest + fast mode', () => {
  it('reads service_tier before stripping it', () => {
    const b = body({ service_tier: 'priority' })
    const result = transformRequest(b)
    expect(result.fastMode.fast).toBe(true)
    expect(b.speed).toBe('fast')
    expect(b.service_tier).toBeUndefined()
  })

  it('leaves standard requests without speed', () => {
    const b = body({ service_tier: 'default' })
    transformRequest(b)
    expect(b.speed).toBeUndefined()
  })
})
