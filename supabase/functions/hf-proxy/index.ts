import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { model, inputs, task } = await req.json()
    const HF_TOKEN = Deno.env.get('HF_TOKEN')

    if (!HF_TOKEN) {
      return new Response(
        JSON.stringify({ error: 'HF_TOKEN not configured' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      )
    }

    const hfUrl = `https://router.huggingface.co/hf-inference/models/${model}`

    const response = await fetch(hfUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${HF_TOKEN}`,
        'Content-Type': 'application/json',
        'x-wait-for-model': 'true',
      },
      body: JSON.stringify({ inputs }),
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      return new Response(
        JSON.stringify({ error: err.error || `HF error: ${response.status}` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: response.status }
      )
    }

    // For image/video — return as base64
    const contentType = response.headers.get('content-type') || ''
    if (contentType.startsWith('image/') || contentType.startsWith('video/')) {
      const buffer = await response.arrayBuffer()
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))
      return new Response(
        JSON.stringify({ data: base64, contentType }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // For JSON responses
    const data = await response.json()
    return new Response(
      JSON.stringify(data),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
