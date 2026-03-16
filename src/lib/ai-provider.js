import { supabase } from './supabase.js'

const AI_ENDPOINT =
  import.meta.env.VITE_AI_ENDPOINT ||
  `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ai-chat`

export async function sendAiMessage(messages, context, options = {}) {
  const { signal } = options

  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session) throw new Error('Not authenticated')
  if (!AI_ENDPOINT) throw new Error('No AI endpoint configured')

  const res = await fetch(AI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      messages,
      context,
    }),
    signal,
  })

  if (!res.ok) {
    const errorText = await res.text().catch(() => 'AI request failed')
    throw new Error(`AI endpoint error (${res.status}): ${errorText}`)
  }

  return res.json()
}
