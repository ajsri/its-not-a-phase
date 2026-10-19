import { generateText, isStepCount, tool, type ModelMessage } from 'ai'
import { z } from 'zod'
import { describePlays, runSql } from './db.ts'
import { getModel, modelId } from './llm.ts'

export type AskRequest = {
  messages: { role: 'user' | 'assistant'; content: string }[]
  spotifyToken?: string
}

export type ToolTrace = { tool: string; input: unknown; output: unknown }

async function systemPrompt() {
  const info = await describePlays()
  return `You answer questions about the user's Spotify listening history.

Data: a DuckDB table \`plays\` built from the user's Extended Streaming History export, one row per playback.
${info.rows} rows, ${info.first} to ${info.last}. Timestamps in \`played_at\` are the user's local time.
Columns:
${info.columns.join('\n')}

Notes:
- "Most listened" is ambiguous: rank by total minutes_played by default, and also report the counted play total.
- Spotify counts a play as a stream at 30s+; that is \`counted_play\`. Rows with very low ms_played are skips/scrubs.
- Filter \`kind = 'track'\` for music questions; track/artist/album are null for podcasts.
- Artist is the album artist, so features aren't separate rows.
- Today's date: ${new Date().toISOString().slice(0, 10)}.

Tools:
- run_sql for anything historical. Only SELECT/WITH queries; results are capped at 200 rows, so aggregate and LIMIT.
- spotify_api for live data the export lacks: current playlists, saved tracks, now playing, track/artist details (genres, images, popularity). Track URIs in \`plays\` are "spotify:track:<id>".

Answer concisely with the actual numbers. If a query fails, fix it and retry.`
}

export async function ask({ messages, spotifyToken }: AskRequest) {
  const trace: ToolTrace[] = []

  const tools = {
    run_sql: tool({
      description: 'Run a read-only DuckDB SQL query against the `plays` table and return rows as JSON.',
      inputSchema: z.object({ sql: z.string().describe('A single SELECT or WITH query') }),
      execute: async ({ sql }) => {
        try {
          const out = await runSql(sql)
          trace.push({ tool: 'run_sql', input: { sql }, output: out })
          return out
        } catch (e) {
          const out = { error: (e as Error).message }
          trace.push({ tool: 'run_sql', input: { sql }, output: out })
          return out
        }
      },
    }),
    spotify_api: tool({
      description:
        'GET a Spotify Web API endpoint as the logged-in user, e.g. "/me/playlists?limit=50" or "/tracks?ids=a,b". Read-only.',
      inputSchema: z.object({ path: z.string().describe('Path under https://api.spotify.com/v1, starting with /') }),
      execute: async ({ path }) => {
        let out: unknown
        if (!spotifyToken) {
          out = { error: 'User is not logged in to Spotify in the app' }
        } else {
          const res = await fetch(`https://api.spotify.com/v1${path.startsWith('/') ? '' : '/'}${path}`, {
            headers: { Authorization: `Bearer ${spotifyToken}` },
          })
          const text = await res.text()
          // Keep tool results small; the API returns lots of image/market noise.
          out = { status: res.status, body: text.slice(0, 20_000) }
        }
        trace.push({ tool: 'spotify_api', input: { path }, output: out })
        return out
      },
    }),
  }

  const result = await generateText({
    model: getModel(),
    system: await systemPrompt(),
    messages: messages as ModelMessage[],
    tools,
    stopWhen: isStepCount(12),
  })

  const answer = result.text || `_Stopped after ${result.steps.length} steps without a final answer. Try a more specific question._`
  return { answer, trace, model: modelId(), usage: result.totalUsage }
}
