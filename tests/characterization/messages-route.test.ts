import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type FetchLike = typeof fetch

// Point XDG_CONFIG_HOME at a fresh temp dir and plant a valid-looking auth file
// so the module-default `src/server.ts` (which wires the real file credential
// store) reads a predictable access token back.
function setupTempConfigWithAuth(access: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cursor-claude-test-'))
  const subdir = join(dir, 'cursor-claude')
  mkdirSync(subdir, { recursive: true })
  const authPath = join(subdir, 'auth.json')
  writeFileSync(
    authPath,
    JSON.stringify({
      'auth:anthropic': {
        type: 'oauth',
        refresh: 'refresh-token',
        access,
        expires: Date.now() + 60_000,
      },
    }),
  )
  return dir
}

describe('characterization: /v1/chat/completions route', () => {
  let originalFetch: FetchLike
  let tempDir: string | null = null
  let originalXdg: string | undefined

  let savedEnv: Record<string, string | undefined> = {}

  beforeEach(() => {
    originalFetch = globalThis.fetch
    vi.resetModules()
    originalXdg = process.env.XDG_CONFIG_HOME
    // Stash any env that would redirect credential storage away from the file store.
    savedEnv = {
      REDIS_URL: process.env.REDIS_URL,
      UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
      UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
      API_KEY: process.env.API_KEY,
    }
    delete process.env.REDIS_URL
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
    tempDir = setupTempConfigWithAuth('mock_access_token')
    process.env.XDG_CONFIG_HOME = tempDir
    process.env.API_KEY = 'test-key'
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    if (originalXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME
    } else {
      process.env.XDG_CONFIG_HOME = originalXdg
    }
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true })
      } catch {
        // best-effort cleanup
      }
      tempDir = null
    }
    vi.resetModules()
    vi.unstubAllEnvs()
  })

  it('rejects with 401 when authorization header does not match API_KEY', async () => {
    const { default: app } = await import('../../src/server')
    const res = await app.fetch(
      new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer wrong-key',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it('cursor BYOK probe (gpt-4o model) returns bypass response', async () => {
    const { default: app } = await import('../../src/server')
    const res = await app.fetch(
      new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer test-key',
        },
        body: JSON.stringify({
          model: 'gpt-4o-2024-08-06',
          messages: [{ role: 'user', content: 'ping' }],
        }),
      }),
    )
    expect(res.status).toBe(200)
    const json = (await res.json()) as any
    expect(json.model).toMatch(/gpt-4o/)
    expect(Array.isArray(json.choices)).toBe(true)
  })

  it('strips OpenAI-only fields (stream_options, frequency_penalty, etc.) before forwarding', async () => {
    let forwardedBody: any = null
    globalThis.fetch = vi.fn(async (_url: any, init?: any) => {
      forwardedBody = JSON.parse((init?.body as string) ?? '{}')
      return new Response(
        JSON.stringify({
          id: 'msg_1',
          model: 'claude-sonnet-4-20250514',
          content: [{ type: 'text', text: 'ok' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as FetchLike

    const { default: app } = await import('../../src/server')
    const res = await app.fetch(
      new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer test-key',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          messages: [{ role: 'user', content: 'hi' }],
          stream_options: { include_usage: true },
          frequency_penalty: 0.1,
          presence_penalty: 0.1,
          logit_bias: { '1': 1 },
          logprobs: true,
          top_logprobs: 3,
          n: 1,
          response_format: { type: 'json_object' },
          seed: 42,
          service_tier: 'auto',
          store: false,
        }),
      }),
    )

    expect(res.status).toBe(200)
    expect(forwardedBody).not.toBeNull()
    for (const banned of [
      'stream_options',
      'frequency_penalty',
      'presence_penalty',
      'logit_bias',
      'logprobs',
      'top_logprobs',
      'n',
      'response_format',
      'seed',
      'service_tier',
      'store',
    ]) {
      expect(forwardedBody[banned]).toBeUndefined()
    }
  })

  it('injects claude-code system prompt and pins max_tokens for opus when system is missing that marker', async () => {
    let forwardedBody: any = null
    globalThis.fetch = vi.fn(async (_url: any, init?: any) => {
      forwardedBody = JSON.parse((init?.body as string) ?? '{}')
      return new Response(
        JSON.stringify({
          id: 'msg_opus',
          model: 'claude-opus-4-20250514',
          content: [{ type: 'text', text: 'hi' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as FetchLike

    const { default: app } = await import('../../src/server')
    const res = await app.fetch(
      new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer test-key',
        },
        body: JSON.stringify({
          model: 'claude-opus-4-20250514',
          messages: [
            { role: 'system', content: 'Be concise.' },
            { role: 'user', content: 'hi' },
          ],
        }),
      }),
    )

    expect(res.status).toBe(200)
    expect(forwardedBody.max_tokens).toBe(32_000)
    expect(Array.isArray(forwardedBody.system)).toBe(true)
    const allSystemText = forwardedBody.system
      .map((s: any) => s.text)
      .join('\n')
    expect(allSystemText).toMatch(/You are Claude Code/)
    expect(allSystemText).toMatch(/Be concise\./)
    const roles = forwardedBody.messages.map((m: any) => m.role)
    expect(roles).not.toContain('system')
  })

  it('pins max_tokens=64000 for sonnet when system lacks claude-code marker', async () => {
    let forwardedBody: any = null
    globalThis.fetch = vi.fn(async (_url: any, init?: any) => {
      forwardedBody = JSON.parse((init?.body as string) ?? '{}')
      return new Response(
        JSON.stringify({
          id: 'msg_sonnet',
          model: 'claude-sonnet-4-20250514',
          content: [{ type: 'text', text: 'hi' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as FetchLike

    const { default: app } = await import('../../src/server')
    const res = await app.fetch(
      new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer test-key',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      }),
    )

    expect(res.status).toBe(200)
    expect(forwardedBody.max_tokens).toBe(64_000)
  })

  it('passes through claude-code native requests (system already has marker) without adding max_tokens', async () => {
    let forwardedBody: any = null
    globalThis.fetch = vi.fn(async (_url: any, init?: any) => {
      forwardedBody = JSON.parse((init?.body as string) ?? '{}')
      return new Response(
        JSON.stringify({
          id: 'msg_native',
          model: 'claude-sonnet-4-20250514',
          content: [{ type: 'text', text: 'hi' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as FetchLike

    const { default: app } = await import('../../src/server')
    const res = await app.fetch(
      new Request('http://localhost/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer test-key',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          system: [
            {
              type: 'text',
              text: "You are Claude Code, Anthropic's official CLI for Claude. Bla bla.",
            },
          ],
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 100,
        }),
      }),
    )

    expect(res.status).toBe(200)
    expect(forwardedBody.max_tokens).toBe(100)
    expect(forwardedBody.system[0].text).toMatch(/You are Claude Code/)
  })

  it('forwards anthropic headers (oauth bearer, anthropic-beta, anthropic-version)', async () => {
    let forwardedHeaders: Record<string, string> = {}
    globalThis.fetch = vi.fn(async (_url: any, init?: any) => {
      forwardedHeaders = init?.headers ?? {}
      return new Response(
        JSON.stringify({
          id: 'msg_h',
          model: 'claude-sonnet-4-20250514',
          content: [{ type: 'text', text: 'hi' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as FetchLike

    const { default: app } = await import('../../src/server')
    const res = await app.fetch(
      new Request('http://localhost/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer test-key',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          messages: [{ role: 'user', content: 'hi' }],
        }),
      }),
    )

    expect(res.status).toBe(200)
    expect(forwardedHeaders['authorization']).toBe('Bearer mock_access_token')
    expect(forwardedHeaders['anthropic-beta']).toMatch(/oauth-2025-04-20/)
    expect(forwardedHeaders['anthropic-version']).toBe('2023-06-01')
  })
})
