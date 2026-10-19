import { useEffect, useState } from 'react'
import {
  REDIRECT_URI,
  type StoredToken,
  getStoredToken,
  handleCallback,
  hasClientId,
  login,
  logout,
  refreshToken,
  spotifyFetch,
} from './spotify'
import { Chat } from './Chat'

const PRESETS = [
  '/me',
  '/me/top/tracks?time_range=long_term&limit=50',
  '/me/top/artists?time_range=medium_term&limit=20',
  '/me/player/recently-played?limit=50',
  '/me/playlists?limit=50',
  '/me/tracks?limit=50',
  '/search?type=track&limit=10&q=radiohead',
]

function App() {
  const [token, setToken] = useState<StoredToken | null>(getStoredToken)
  const [error, setError] = useState<string | null>(null)
  const [path, setPath] = useState(PRESETS[0])
  const [result, setResult] = useState<string>('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (window.location.pathname !== '/callback') return
    handleCallback()
      .then(setToken)
      .catch((e: Error) => setError(e.message))
      .finally(() => window.history.replaceState({}, '', '/'))
  }, [])

  async function run(p = path) {
    setLoading(true)
    setError(null)
    try {
      const res = await spotifyFetch(p)
      setResult(`HTTP ${res.status}\n\n${JSON.stringify(res.body, null, 2)}`)
      setToken(getStoredToken()) // may have been refreshed
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main>
      <header>
        <h1>It's Not a Phase</h1>
        <p className="muted">Ask your Spotify listening history who you used to be.</p>
      </header>
      {error && <p className="error">{error}</p>}
      <Chat />

      <details>
        <summary>
          Spotify login{' '}
          <span className="muted">
            {token ? '(logged in)' : '(optional, enables live data like playlists and genres)'}
          </span>
        </summary>
      {!hasClientId() ? (
        <p className="muted">
          Set <code>VITE_SPOTIFY_CLIENT_ID</code> in <code>.env.local</code> and register{' '}
          <code>{REDIRECT_URI}</code> as a redirect URI in your Spotify app. See the README.
        </p>
      ) : !token ? (
        <button onClick={() => login().catch((e: Error) => setError(e.message))}>Log in with Spotify</button>
      ) : (
        <>
          <section>
            <label>Access token (Bearer)</label>
            <textarea readOnly rows={4} value={token.access_token} onFocus={(e) => e.target.select()} />
            <div className="row">
              <button onClick={() => navigator.clipboard.writeText(token.access_token)}>Copy</button>
              <button onClick={() => refreshToken().then(setToken).catch((e: Error) => setError(e.message))}>
                Refresh
              </button>
              <button
                onClick={() => {
                  logout()
                  setToken(null)
                }}
              >
                Log out
              </button>
              <span className="muted">expires {new Date(token.expires_at).toLocaleTimeString()}</span>
            </div>
            <details>
              <summary>Granted scopes</summary>
              <p className="muted">{token.scope.split(' ').join(', ')}</p>
            </details>
          </section>

          <section>
            <label>Try the API (GET)</label>
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault()
                run()
              }}
            >
              <input value={path} onChange={(e) => setPath(e.target.value)} />
              <button disabled={loading}>{loading ? '…' : 'Send'}</button>
            </form>
            <div className="presets">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  className="chip"
                  onClick={() => {
                    setPath(p)
                    run(p)
                  }}
                >
                  {p}
                </button>
              ))}
            </div>
            {result && <pre>{result}</pre>}
          </section>
        </>
      )}
      </details>
    </main>
  )
}

export default App
