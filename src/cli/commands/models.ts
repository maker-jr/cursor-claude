import pc from 'picocolors'
import {
  extractAnthropicModels,
  toOpenAiList,
  type ModelEntry,
  type RawModelsDevResponse,
} from '../../domain/proxy/models'
import type { Deps } from '../../ports'

export interface ModelsOptions {
  /** Print the OpenAI-shaped JSON payload (for scripts). */
  json?: boolean
  /** Print one model id per line (plays nicely with shell pipes). */
  idsOnly?: boolean
}

/**
 * `cursor-claude models` — list the Claude models the proxy can serve,
 * sourced from models.dev (same data the running proxy returns at /v1/models).
 *
 * Output modes (mutually exclusive; --json wins if both are passed):
 *   - default   : human-readable table with usage tip
 *   - --json    : OpenAI list payload, suitable for piping into jq
 *   - --ids-only: one model id per line, no decoration
 */
export async function runModels(
  deps: Deps,
  opts: ModelsOptions = {},
): Promise<void> {
  let raw: RawModelsDevResponse
  try {
    raw = (await deps.anthropic.fetchModels()) as RawModelsDevResponse
  } catch (err) {
    console.error(pc.red('✗ Failed to fetch model list:'))
    console.error('  ' + (err instanceof Error ? err.message : String(err)))
    console.error()
    console.error(
      pc.dim('  Source: https://models.dev/api.json. Check your network.'),
    )
    process.exitCode = 1
    return
  }

  const entries = extractAnthropicModels(raw)

  if (opts.json) {
    // Stable JSON: keys exactly mirror /v1/models so scripts that already
    // consume that endpoint can reuse their parsers without changes.
    process.stdout.write(JSON.stringify(toOpenAiList(entries), null, 2) + '\n')
    return
  }

  if (opts.idsOnly) {
    for (const e of entries) {
      process.stdout.write(e.id + '\n')
    }
    return
  }

  printTable(entries)
}

function printTable(entries: ModelEntry[]): void {
  if (entries.length === 0) {
    console.log(
      pc.yellow(
        'No Anthropic models found in the upstream catalog (models.dev).',
      ),
    )
    return
  }

  const header = { id: 'ID', name: 'Name', date: 'Released' }
  const idWidth = Math.max(
    header.id.length,
    ...entries.map((e) => e.id.length),
  )
  const nameWidth = Math.max(
    header.name.length,
    ...entries.map((e) => e.name.length),
  )
  const dateWidth = Math.max(
    header.date.length,
    ...entries.map((e) => (e.releaseDate ?? '—').length),
  )

  console.log()
  console.log(pc.bold('Anthropic models available through your subscription'))
  console.log(pc.dim('  Source: https://models.dev'))
  console.log()
  console.log(
    '  ' +
      pc.bold(pad(header.id, idWidth)) +
      '  ' +
      pc.bold(pad(header.name, nameWidth)) +
      '  ' +
      pc.bold(pad(header.date, dateWidth)),
  )
  console.log(
    '  ' +
      pc.dim(rule(idWidth)) +
      '  ' +
      pc.dim(rule(nameWidth)) +
      '  ' +
      pc.dim(rule(dateWidth)),
  )
  for (const e of entries) {
    console.log(
      '  ' +
        pc.cyan(pad(e.id, idWidth)) +
        '  ' +
        pad(e.name, nameWidth) +
        '  ' +
        pc.dim(pad(e.releaseDate ?? '—', dateWidth)),
    )
  }
  console.log()
  console.log(
    pc.dim('  In Cursor: Settings -> Models -> Add model -> paste an ID above.'),
  )
  console.log(
    pc.dim('  Tips: ') +
      pc.bold('cursor-claude models --json') +
      pc.dim(' or ') +
      pc.bold('--ids-only') +
      pc.dim(' for scripts.'),
  )
  console.log()
}

function pad(s: string, w: number): string {
  return s + ' '.repeat(Math.max(0, w - s.length))
}

function rule(w: number): string {
  return '─'.repeat(w)
}
