import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY')

    if (!anthropicApiKey) {
      return new Response(JSON.stringify({ error: 'Missing ANTHROPIC_API_KEY secret' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    })

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser()

    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { messages = [], context = {} } = await req.json()

    const systemPrompt = `
You are Anka AI, the assistant inside Anka OS.

You are helping users inside an internal organizational operating system.
Be practical, concise, and environment-aware.

Current context:
- route: ${context.currentPage || 'unknown'}
- role: ${context.userRole || 'unknown'}
- department: ${context.department || 'unknown'}

What you can reliably help with right now:
- summarize tasks, blockers, and development status
- explain current page context
- propose task creation
- propose project creation
- propose task completion

If you want to propose an action, include exactly one action block in this format:

[ANKA_ACTION]{"type":"team.create_task","description":"Create a new task","params":{"title":"...","priority":"medium","project_id":null,"assignee":null}}[/ANKA_ACTION]

Supported action types:
- team.create_task
- team.complete_task
- team.create_project

Do not invent unsupported action types.
Do not claim that an action has already happened unless it has been approved and executed.
`

    const model = Deno.env.get('ANTHROPIC_MODEL') || 'claude-3-5-sonnet-latest'

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1400,
        system: systemPrompt,
        messages: messages.map((m: any) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: String(m.content || ''),
        })),
      }),
    })

    if (!anthropicRes.ok) {
      const errorText = await anthropicRes.text()
      return new Response(JSON.stringify({ error: errorText }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const data = await anthropicRes.json()
    const content = data?.content?.[0]?.text || ''

    return new Response(
      JSON.stringify({
        content,
        provider: 'anthropic',
        model,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
