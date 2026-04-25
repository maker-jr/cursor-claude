import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type {
  CredentialStore,
  OAuthCredentials,
} from '../../ports/credential-store'
import { getAuthFilePath } from './paths'

type AuthFile = Record<string, OAuthCredentials>

async function readFile(): Promise<AuthFile> {
  try {
    const raw = await fs.readFile(getAuthFilePath(), 'utf8')
    return JSON.parse(raw) as AuthFile
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return {}
    throw err
  }
}

async function writeFile(data: AuthFile): Promise<void> {
  const path = getAuthFilePath()
  await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const contents = JSON.stringify(data, null, 2)
  await fs.writeFile(path, contents, { encoding: 'utf8', mode: 0o600 })
  try {
    await fs.chmod(path, 0o600)
  } catch {
    // Non-POSIX filesystems may reject chmod; ignore.
  }
}

export function createFileCredentialStore(): CredentialStore {
  return {
    async get(key) {
      const data = await readFile()
      return data[key] ?? null
    },
    async set(key, credentials) {
      const data = await readFile()
      data[key] = credentials
      await writeFile(data)
    },
    async del(key) {
      const data = await readFile()
      if (!(key in data)) return
      delete data[key]
      await writeFile(data)
    },
  }
}
