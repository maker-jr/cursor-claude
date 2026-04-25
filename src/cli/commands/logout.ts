import pc from 'picocolors'
import type { Deps } from '../../ports'

const AUTH_KEY = 'auth:anthropic'

export async function runLogout(deps: Deps): Promise<void> {
  try {
    await deps.credentialStore.del(AUTH_KEY)
    console.log(pc.green('✓') + ' Removed stored OAuth credentials.')
  } catch (err) {
    console.error(pc.red('✗ Logout failed:'))
    console.error('  ' + (err instanceof Error ? err.message : String(err)))
    process.exitCode = 1
  }
}
