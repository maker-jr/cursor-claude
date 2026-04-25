import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createJsonConfigStore } from './json-config-store'
import { getConfigFilePath } from './paths'

describe('createJsonConfigStore', () => {
  let tempRoot: string
  let savedXdg: string | undefined

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'cc-json-config-'))
    savedXdg = process.env.XDG_CONFIG_HOME
    process.env.XDG_CONFIG_HOME = tempRoot
  })

  afterEach(() => {
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME
    else process.env.XDG_CONFIG_HOME = savedXdg
    try {
      rmSync(tempRoot, { recursive: true, force: true })
    } catch {}
  })

  it('getApiKey returns undefined when no file exists', async () => {
    const store = createJsonConfigStore()
    expect(await store.getApiKey()).toBeUndefined()
  })

  it('setApiKey persists with 0600 mode and getApiKey reads it back', async () => {
    const store = createJsonConfigStore()
    await store.setApiKey('abc')
    expect(await store.getApiKey()).toBe('abc')

    if (process.platform !== 'win32') {
      const st = statSync(getConfigFilePath())
      expect(st.mode & 0o777).toBe(0o600)
    }
  })

  it('setApiKey preserves other (unknown) config keys', async () => {
    // Write an extra key manually to simulate future fields.
    const store = createJsonConfigStore()
    await store.setApiKey('one')
    const fs = await import('node:fs/promises')
    const raw = JSON.parse(await fs.readFile(getConfigFilePath(), 'utf8'))
    raw.someOtherField = 'kept'
    await fs.writeFile(getConfigFilePath(), JSON.stringify(raw))
    await store.setApiKey('two')
    const after = JSON.parse(await fs.readFile(getConfigFilePath(), 'utf8'))
    expect(after.apiKey).toBe('two')
    expect(after.someOtherField).toBe('kept')
  })
})
