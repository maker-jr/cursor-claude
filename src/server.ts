import 'dotenv/config'
import { serve } from '@hono/node-server'
import { createHttpAnthropicClient } from './adapters/anthropic/http-client'
import { createHttpOAuthClient } from './adapters/oauth/http-client'
import { consoleLogger } from './adapters/process/console-logger'
import { systemClock } from './adapters/process/system-clock'
import { getCredentialStore } from './adapters/storage/create-credential-store'
import { createApp } from './http/app'

// Build a default production app. Kept as a module default export so
// `api/index.ts` (Vercel) and `node dist/server.js` both keep working without
// changes, and so the characterization tests can still import from this file.
const app = createApp({
  anthropic: createHttpAnthropicClient(),
  oauth: createHttpOAuthClient(),
  credentialStore: getCredentialStore().store,
  clock: systemClock,
  logger: consoleLogger,
  getExpectedApiKey: () => process.env.API_KEY,
})

export default app

const port = Number(process.env.PORT) || 9095

// Start HTTP server when running locally (`node dist/server.js`), not when
// bundled as a Vercel handler.
if (require.main === module) {
  const server = serve(
    {
      fetch: app.fetch,
      port,
    },
    (info) => {
      const addr = info && 'port' in info ? info.port : port
      console.log(`Listening on http://localhost:${addr}`)
    },
  )

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `Port ${port} is already in use (another server instance may still be running).`,
      )
      console.error(
        `Stop that process, or use a different port: PORT=9096 npm start`,
      )
      console.error(`Find the process: lsof -nP -iTCP:${port} -sTCP:LISTEN`)
    } else {
      console.error(err)
    }
    process.exit(1)
  })
}
