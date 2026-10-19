# It's Not a Phase

Ask your Spotify listening history who you used to be.

> "What did I listen to most in 2022?"
> "Which artists did I play nonstop in college and then never again?"
> "What do I listen to at 2am?"

It's Not a Phase loads your full Spotify history (every play since you opened your account) into a local DuckDB database. An LLM turns your questions into SQL and answers from the results. Each answer shows the queries the LLM ran, so you can check them.

Everything runs on your machine. Your history never leaves it, except for the query results the LLM needs to write its answer.

## 1. Request your Spotify data (do this first, it takes a while)

The Spotify API only covers about the last year. The full history comes from a data export:

1. Go to **[spotify.com/account/privacy](https://www.spotify.com/account/privacy/)** and log in.
2. Under **Download your data**, select **Extended streaming history**. The other boxes aren't needed.
3. Click **Request data**, then confirm via the email Spotify sends you.
4. Wait. Spotify says it can take **up to 30 days**, but it's often much faster. You'll get an email with a download link.
5. Download and unzip it. You'll get a folder of `Streaming_History_Audio_<year>.json` files (plus a PDF that explains the fields).

## 2. Set up the app

You need [Node.js](https://nodejs.org) 22 or newer and an API key for an LLM. Anthropic and OpenAI both work.

```bash
git clone <this repo> its-not-a-phase
cd its-not-a-phase
npm install
cp .env.example .env.local
```

Edit `.env.local` and add your key:

```bash
LLM_MODEL=anthropic:claude-opus-5-5
ANTHROPIC_API_KEY=sk-ant-...
```

Then copy the unzipped export into `data/`. Copy the whole folder or just the JSON files; the app searches `data/` and any folders inside it.

```bash
cp -r ~/Downloads/"Spotify Extended Streaming History" data/
```

## 3. Run it

```bash
npm run dev
```

Open **http://127.0.0.1:5173** and ask away. Expand **tool calls** under any answer to see the SQL it ran.

## Optional: connect your Spotify account

The export only covers history. If you also want questions that need live data, like "which of my playlists have the most songs from my 2019 top 10?", "what genres is that artist?" or "what's playing now?", connect your Spotify account:

1. Create an app at **[developer.spotify.com/dashboard](https://developer.spotify.com/dashboard)**. Select **Web API** when asked which APIs you'll use.
2. Add this redirect URI **exactly**: `http://127.0.0.1:5173/callback`. Spotify rejects `localhost`.
3. Copy the **Client ID** into `.env.local` as `VITE_SPOTIFY_CLIENT_ID=...`. You don't need the client secret; the app uses the Authorization Code + PKCE flow.
4. Restart `npm run dev`, expand **Spotify login** in the app and log in.

New Spotify apps start in development mode, where only accounts listed under **User Management** in the dashboard can log in. Your own account works as the app's owner.

The LLM only gets **read** access to the Spotify API. It can't change your playlists or library.

## Choosing a model

Set `LLM_MODEL` in `.env.local` to `<provider>:<model id>`:

| `LLM_MODEL` | Notes |
|---|---|
| `anthropic:claude-opus-5-5` | Default. Best at tricky multi-step questions. Roughly $0.10–0.15 per question. |
| `anthropic:claude-sonnet-5-5` | About half the cost; handles most questions fine. |
| `anthropic:claude-haiku-5-5` | Very cheap; fine for simple "top N" questions. |
| `openai:<model>` | Set `OPENAI_API_KEY` instead. |

Each answer shows the model and token counts, so you can see what you're spending. Vite restarts by itself when `.env.local` changes.

A ChatGPT or Claude.ai subscription is not an API key. Get keys from [console.anthropic.com](https://console.anthropic.com) or [platform.openai.com](https://platform.openai.com).

## How it works

```
question ─▶ LLM ─▶ run_sql ─────▶ DuckDB (plays table, in memory)
                 └▶ spotify_api ─▶ Spotify Web API (optional, read-only)
          ◀── answer + the queries it ran
```

- **`server/db.ts`** loads the export into a `plays` table with columns ready for querying: `played_at` (your local time), `year`, `month`, `hour`, `weekday`, `track`, `artist`, `album`, `minutes_played`, `counted_play` (30s or more, Spotify's own rule for counting a stream), `skipped`, `shuffle`, `platform` and so on.
- **`server/ask.ts`** holds the system prompt and the two tools the LLM can call.
- **`server/llm.ts`** is the provider layer (built on the [Vercel AI SDK](https://ai-sdk.dev)). To add another provider, register it there.
- **`vite.config.ts`** serves `POST /api/ask` from the Vite dev server, so API keys stay server-side and never reach the browser.
- **`src/`** is the React UI (`Chat.tsx`) and the Spotify PKCE login (`spotify.ts`).

## Privacy

- `data/` and `.env.local` are gitignored. **Don't commit your export**: it includes the IP address of every play.
- The `ip_addr` column is never loaded into the database, so the LLM can't see it.
- The LLM gets the table schema plus the results of the queries it runs, not your raw history. Query results are sent to the LLM provider you configure.
- Model-written SQL is limited to single `SELECT`/`WITH` queries, and DuckDB's file and network access is turned off after loading.

## Troubleshooting

| Problem | Fix |
|---|---|
| `No Streaming_History_Audio_*.json files found` | Put the export JSONs somewhere under `data/`. |
| `ANTHROPIC_API_KEY is not set` | Add it to `.env.local`. Check that `LLM_MODEL` names the provider you have a key for. |
| Spotify login says `INVALID_CLIENT: Invalid redirect URI` | The dashboard redirect URI must be exactly `http://127.0.0.1:5173/callback`. |
| Spotify login works for you but not a friend | Add their Spotify email under **User Management** in your Spotify app, or have them create their own app. |
| Port 5173 already in use | Stop the other dev server. The port is fixed because it must match the Spotify redirect URI. |

## License

[MIT](LICENSE)
