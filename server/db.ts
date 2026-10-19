import { DuckDBInstance, StatementType, type DuckDBConnection } from '@duckdb/node-api'

// Recursive so the unzipped export folder can be dropped into data/ as-is.
const DATA_GLOB = 'data/**/Streaming_History_Audio_*.json'
const MAX_ROWS = 200

// Clean view of the export for the model. ip_addr is deliberately left out so it never reaches the LLM.
const CREATE_PLAYS = (tz: string) => `
CREATE TABLE plays AS
SELECT
  (ts AT TIME ZONE 'UTC') AT TIME ZONE '${tz}'          AS played_at,
  ts                                                     AS played_at_utc,
  year(played_at)                                        AS year,
  month(played_at)                                       AS month,
  CAST(played_at AS DATE)                                AS date,
  hour(played_at)                                        AS hour,
  dayname(played_at)                                     AS weekday,
  CASE WHEN spotify_track_uri IS NOT NULL THEN 'track'
       WHEN spotify_episode_uri IS NOT NULL THEN 'episode'
       WHEN audiobook_uri IS NOT NULL THEN 'audiobook'
       ELSE 'unknown' END                                AS kind,
  master_metadata_track_name                             AS track,
  master_metadata_album_artist_name                      AS artist,
  master_metadata_album_album_name                       AS album,
  spotify_track_uri                                      AS track_uri,
  episode_name, episode_show_name AS show_name, audiobook_title,
  ms_played,
  ms_played / 60000.0                                    AS minutes_played,
  ms_played >= 30000                                     AS counted_play,
  platform, conn_country AS country, reason_start, reason_end,
  shuffle, skipped, offline, incognito_mode
FROM read_json('${DATA_GLOB}', format = 'array', union_by_name = true)
`

async function init(): Promise<DuckDBConnection> {
  const tz = process.env.TZ_NAME || Intl.DateTimeFormat().resolvedOptions().timeZone
  const conn = await (await DuckDBInstance.create(':memory:')).connect()
  try {
    await conn.run(CREATE_PLAYS(tz))
  } catch (e) {
    if (/no files found/i.test((e as Error).message)) {
      throw new Error('No Streaming_History_Audio_*.json files found in data/. See the README for how to get your export.')
    }
    throw e
  }
  // Once loaded, block file/network access so model-written SQL can only touch the in-memory table.
  await conn.run(`SET enable_external_access = false`)
  await conn.run(`SET lock_configuration = true`)
  return conn
}

// Cache on globalThis so Vite's server-module reloads don't reload the data each time.
const g = globalThis as { __spotifyDb?: Promise<DuckDBConnection> }
export function getDb() {
  g.__spotifyDb ??= init().catch((e) => {
    g.__spotifyDb = undefined
    throw e
  })
  return g.__spotifyDb
}

export async function describePlays() {
  const conn = await getDb()
  const cols = (await conn.runAndReadAll(`DESCRIBE plays`)).getRowObjectsJson()
  const stats = (
    await conn.runAndReadAll(`SELECT count(*) AS rows, min(played_at) AS first, max(played_at) AS last FROM plays`)
  ).getRowObjectsJson()[0] as { rows: string; first: string; last: string }
  return { columns: cols.map((c) => `${c.column_name} ${c.column_type}`), ...stats }
}

export async function runSql(sql: string) {
  const conn = await getDb()
  // Let DuckDB's parser decide: a text check misses things like `WITH x AS (...) DELETE ...`.
  const statements = await conn.extractStatements(sql)
  if (statements.count !== 1) throw new Error('Only a single SELECT query is allowed')
  const prepared = await statements.prepare(0)
  if (prepared.statementType !== StatementType.SELECT) throw new Error('Only a single SELECT query is allowed')
  const rows = (await prepared.runAndReadAll()).getRowObjectsJson()
  return {
    rowCount: rows.length,
    truncated: rows.length > MAX_ROWS,
    rows: rows.slice(0, MAX_ROWS),
  }
}
