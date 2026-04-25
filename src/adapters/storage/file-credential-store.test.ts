import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createFileCredentialStore } from './file-credential-store'
import { getAuthFilePath } from './paths'

const KEY = 'auth:anthropic'

describe('createFileCredentialStore', () => {
  let tempRoot: string
  let savedXdg: string | undefined

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'cc-file-store-'))
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

  it('set → get round-trips the credential and writes 0600 mode on POSIX', async () => {
    const store = createFileCredentialStore()
    const creds = {
      type: 'oauth' as const,
      refresh: 'r',
      access: 'a',
      expires: 123,
    }
    await store.set(KEY, creds)
    const loaded = await store.get(KEY)
    expect(loaded).toEqual(creds)

    if (process.platform !== 'win32') {
      const st = statSync(getAuthFilePath())
      // Low 9 bits should be 0o600.
      expect(st.mode & 0o777).toBe(0o600)
    }
  })

  it('get returns null when no file exists', async () => {
    const store = createFileCredentialStore()
    const res = await store.get(KEY)
    expect(res).toBeNull()
  })

  it('del removes the credential', async () => {
    const store = createFileCredentialStore()
    await store.set(KEY, {
      type: 'oauth',
      refresh: 'r',
      access: 'a',
      expires: 1,
    })
    await store.del(KEY)
    expect(await store.get(KEY)).toBeNull()
  })

  it('del on a missing key is a no-op', async () => {
    const store = createFileCredentialStore()
    await expect(store.del('does-not-exist')).resolves.toBeUndefined()
  })
})
