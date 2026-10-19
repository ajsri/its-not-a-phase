import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

// Dev-only backend: POST /api/ask runs the LLM + DuckDB code in server/ (keys never reach the browser).
function api(): Plugin {
  return {
    name: 'spotify-ask-api',
    configureServer(server) {
      server.middlewares.use('/api/ask', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          return res.end()
        }
        // Block other websites from POSTing here and spending API credits. Requiring JSON forces a CORS
        // preflight (which Vite rejects for foreign origins), and the Origin check covers the rest.
        const origin = req.headers.origin
        if (!req.headers['content-type']?.startsWith('application/json') || (origin && origin !== `http://${req.headers.host}`)) {
          res.statusCode = 403
          return res.end()
        }
        try {
          let body = ''
          for await (const chunk of req) body += chunk
          // ssrLoadModule picks up edits to server/*.ts without restarting Vite.
          const { ask } = await server.ssrLoadModule('/server/ask.ts')
          const result = await ask(JSON.parse(body))
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(result))
        } catch (e) {
          console.error(e)
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: (e as Error).message }))
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // Expose non-VITE_ vars (API keys, LLM_MODEL) to server code only.
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''))
  return {
    plugins: [react(), api()],
    // Spotify rejects "localhost" redirect URIs; it must be a loopback IP.
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
  }
})
