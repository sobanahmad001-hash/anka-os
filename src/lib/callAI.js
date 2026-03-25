/**
 * callAI — GPT-4.1 primary, Claude claude-sonnet-4-20250514 fallback.
 *
 * @param {object} opts
 * @param {string}  opts.system      - System prompt
 * @param {Array}   opts.messages    - [{ role, content }, ...]
 * @param {number}  [opts.maxTokens] - Max tokens (default 2000)
 * @returns {Promise<string>}        - The assistant text response
 */
export async function callAI({ system = '', messages = [], maxTokens = 2000 }) {
  // ── Primary: GPT-4.1 ──────────────────────────────────────────────────────
  try {
    const openaiMessages = [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...messages,
    ]

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${import.meta.env.VITE_OPENAI_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4.1',
        max_tokens: maxTokens,
        messages: openaiMessages,
      }),
    })

    const data = await res.json()
    if (data.error) throw new Error(data.error.message)

    const text = data.choices?.[0]?.message?.content
    if (!text) throw new Error('Empty OpenAI response')
    return text
  } catch (openaiErr) {
    console.warn('[callAI] GPT-4.1 failed, falling back to Claude:', openaiErr.message)
  }

  // ── Fallback: Claude ──────────────────────────────────────────────────────
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': import.meta.env.VITE_CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      ...(system ? { system } : {}),
      messages,
    }),
  })

  const data = await res.json()
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error))

  const text = data.content?.[0]?.text
  if (!text) throw new Error('Empty Claude response')
  return text
}
