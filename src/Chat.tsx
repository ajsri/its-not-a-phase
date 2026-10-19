import { useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { getAccessToken, getStoredToken } from './spotify'

type ToolTrace = { tool: string; input: { sql?: string; path?: string }; output: unknown }
type Turn = { role: 'user' | 'assistant'; content: string; trace?: ToolTrace[]; meta?: string }

const EXAMPLES = [
  'What did I listen to most in 2022?',
  'Who are my top 10 artists of all time by hours?',
  'What time of day do I listen the most?',
  'Which artists did I discover in 2024 and still play in 2026?',
]

export function Chat() {
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send(question: string) {
    if (!question.trim() || loading) return
    const history: Turn[] = [...turns, { role: 'user', content: question }]
    setTurns(history)
    setInput('')
    setLoading(true)
    setError(null)
    try {
      const spotifyToken = getStoredToken() ? await getAccessToken().catch(() => undefined) : undefined
      const res = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history.map(({ role, content }) => ({ role, content })),
          spotifyToken,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      const tokens = json.usage ? `${json.usage.inputTokens ?? '?'} in / ${json.usage.outputTokens ?? '?'} out` : ''
      setTurns([...history, { role: 'assistant', content: json.answer, trace: json.trace, meta: `${json.model} · ${tokens}` }])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <section>
      <label>Ask about your listening</label>
      <div className="turns">
        {turns.map((t, i) => (
          <div key={i} className={`turn ${t.role}`}>
            {t.role === 'assistant' ? (
              <div className="content markdown">
                <Markdown remarkPlugins={[remarkGfm]}>{t.content}</Markdown>
              </div>
            ) : (
              <div className="content">{t.content}</div>
            )}
            {t.trace && t.trace.length > 0 && (
              <details>
                <summary className="muted">
                  {t.trace.length} tool call{t.trace.length === 1 ? '' : 's'} · {t.meta}
                </summary>
                {t.trace.map((c, j) => (
                  <div key={j}>
                    <div className="muted">{c.tool}</div>
                    <pre>{c.input.sql ?? c.input.path}</pre>
                    <pre>{JSON.stringify(c.output, null, 2).slice(0, 4000)}</pre>
                  </div>
                ))}
              </details>
            )}
          </div>
        ))}
        {loading && <div className="turn assistant muted">Thinking…</div>}
      </div>
      {error && <p className="error">{error}</p>}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask a question…" />
        <button disabled={loading}>Ask</button>
        {turns.length > 0 && (
          <button type="button" className="chip" onClick={() => setTurns([])}>
            New chat
          </button>
        )}
      </form>
      {turns.length === 0 && (
        <div className="presets">
          {EXAMPLES.map((q) => (
            <button key={q} className="chip" onClick={() => send(q)}>
              {q}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
