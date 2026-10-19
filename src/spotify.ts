// Spotify Authorization Code + PKCE flow, entirely in the browser (no client secret).

const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID as string | undefined
export const REDIRECT_URI = `${window.location.origin}/callback`
const AUTH_URL = 'https://accounts.spotify.com/authorize'
const TOKEN_URL = 'https://accounts.spotify.com/api/token'
export const API_BASE = 'https://api.spotify.com/v1'

// Every standard user scope (the Open Access "soa-*" partner scopes are excluded;
// requesting them on a normal app fails with invalid_scope).
export const SCOPES = [
  'ugc-image-upload',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'app-remote-control',
  'streaming',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-private',
  'playlist-modify-public',
  'user-follow-modify',
  'user-follow-read',
  'user-read-playback-position',
  'user-top-read',
  'user-read-recently-played',
  'user-library-modify',
  'user-library-read',
  'user-read-email',
  'user-read-private',
]

const VERIFIER_KEY = 'spotify_pkce_verifier'
const STATE_KEY = 'spotify_pkce_state'
const TOKEN_KEY = 'spotify_token'

export type StoredToken = {
  access_token: string
  refresh_token: string
  scope: string
  expires_at: number // epoch ms
}

type TokenResponse = {
  access_token: string
  refresh_token?: string
  scope: string
  expires_in: number
}

export function hasClientId() {
  return Boolean(CLIENT_ID)
}

function randomString(length: number) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

async function codeChallenge(verifier: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export async function login() {
  if (!CLIENT_ID) throw new Error('VITE_SPOTIFY_CLIENT_ID is not set in .env.local')
  const verifier = randomString(64)
  const state = randomString(16)
  sessionStorage.setItem(VERIFIER_KEY, verifier)
  sessionStorage.setItem(STATE_KEY, state)

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES.join(' '),
    code_challenge_method: 'S256',
    code_challenge: await codeChallenge(verifier),
    state,
  })
  window.location.assign(`${AUTH_URL}?${params}`)
}

function saveToken(res: TokenResponse, previousRefresh?: string): StoredToken {
  const token: StoredToken = {
    access_token: res.access_token,
    // Spotify may omit refresh_token on refresh; keep the old one then.
    refresh_token: res.refresh_token ?? previousRefresh ?? '',
    scope: res.scope,
    expires_at: Date.now() + res.expires_in * 1000,
  }
  localStorage.setItem(TOKEN_KEY, JSON.stringify(token))
  return token
}

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(`${json.error}: ${json.error_description ?? ''}`)
  return json
}

// The auth code is single-use; guard against React StrictMode running the effect twice.
let callbackPromise: Promise<StoredToken> | null = null

export function handleCallback(): Promise<StoredToken> {
  callbackPromise ??= (async () => {
    const params = new URLSearchParams(window.location.search)
    const error = params.get('error')
    if (error) throw new Error(`Spotify denied authorization: ${error}`)

    const code = params.get('code')
    const verifier = sessionStorage.getItem(VERIFIER_KEY)
    if (!code || !verifier) throw new Error('Missing auth code or PKCE verifier')
    if (params.get('state') !== sessionStorage.getItem(STATE_KEY)) throw new Error('State mismatch')

    const res = await postToken({
      client_id: CLIENT_ID!,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    })
    sessionStorage.removeItem(VERIFIER_KEY)
    sessionStorage.removeItem(STATE_KEY)
    return saveToken(res)
  })()
  return callbackPromise
}

export function getStoredToken(): StoredToken | null {
  const raw = localStorage.getItem(TOKEN_KEY)
  return raw ? (JSON.parse(raw) as StoredToken) : null
}

export async function refreshToken(): Promise<StoredToken> {
  const current = getStoredToken()
  if (!current?.refresh_token) throw new Error('No refresh token; log in again')
  const res = await postToken({
    client_id: CLIENT_ID!,
    grant_type: 'refresh_token',
    refresh_token: current.refresh_token,
  })
  return saveToken(res, current.refresh_token)
}

// Returns a valid access token, refreshing if it expires within a minute.
export async function getAccessToken(): Promise<string> {
  const token = getStoredToken()
  if (!token) throw new Error('Not logged in')
  if (token.expires_at - Date.now() > 60_000) return token.access_token
  return (await refreshToken()).access_token
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY)
}

// GET/POST/etc. against the Web API. `path` may be "/me" or a full URL (e.g. a `next` link).
export async function spotifyFetch(path: string, init: RequestInit = {}) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path.startsWith('/') ? '' : '/'}${path}`
  const res = await fetch(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${await getAccessToken()}` },
  })
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: res.status, ok: res.ok, body }
}
