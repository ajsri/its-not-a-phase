import { anthropic } from '@ai-sdk/anthropic'
import { openai } from '@ai-sdk/openai'
import { createProviderRegistry } from 'ai'

// Provider shim: pick any registered model with LLM_MODEL="<provider>:<model id>".
// Keys come from ANTHROPIC_API_KEY / OPENAI_API_KEY. Add more providers here.
const registry = createProviderRegistry({ anthropic, openai })

export const DEFAULT_MODEL = 'anthropic:claude-opus-5-5'

export function modelId() {
  return process.env.LLM_MODEL || DEFAULT_MODEL
}

const KEY_ENV: Record<string, string> = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY' }

export function getModel() {
  const keyEnv = KEY_ENV[modelId().split(':')[0]]
  if (keyEnv && !process.env[keyEnv]) throw new Error(`${keyEnv} is not set in .env.local (LLM_MODEL=${modelId()})`)
  return registry.languageModel(modelId() as `anthropic:${string}` | `openai:${string}`)
}
