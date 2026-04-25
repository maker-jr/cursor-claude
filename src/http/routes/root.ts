import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { Context, Hono } from 'hono'

// Serve public/index.html when present; otherwise fall back to a CLI-managed page.

const CLI_FALLBACK_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>cursor-claude</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:4rem auto;padding:0 1rem;line-height:1.5}code{background:#f4f4f4;padding:.1rem .3rem;border-radius:.2rem}</style>
</head><body>
<h1>cursor-claude</h1>
<p>This proxy is managed via the CLI. Run <code>cursor-claude status</code> to see auth and server state, or <code>cursor-claude login</code> to authenticate.</p>
<p>Point your IDE's OpenAI base URL at <code>/v1</code> on this host.</p>
</body></html>`

function getIndexCandidates(): string[] {
  // Support Vercel (cwd is repo root), local `node dist/server.js`, and globally
  // installed CLI (__dirname is inside the installed package).
  return [
    join(process.cwd(), 'public', 'index.html'),
    resolve(__dirname, '..', '..', '..', 'public', 'index.html'),
    resolve(__dirname, '..', '..', 'public', 'index.html'),
  ]
}

let cachedIndexHtml: string | null = null

async function loadIndexHtml(): Promise<string> {
  if (cachedIndexHtml) return cachedIndexHtml
  for (const candidate of getIndexCandidates()) {
    try {
      cachedIndexHtml = await readFile(candidate, 'utf-8')
      return cachedIndexHtml
    } catch {
      // Try next candidate.
    }
  }
  cachedIndexHtml = CLI_FALLBACK_HTML
  return cachedIndexHtml
}

export function registerRootRoutes(app: Hono): void {
  const handler = async (c: Context) => {
    const html = await loadIndexHtml()
    return c.html(html)
  }
  app.get('/', handler)
  app.get('/index.html', handler)
}

// Test hook: reset the memoized HTML cache.
export function resetRootHtmlCache(): void {
  cachedIndexHtml = null
}
