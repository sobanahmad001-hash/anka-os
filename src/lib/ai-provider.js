import { supabase } from './supabase.js';

// ─── Provider Cascade: Claude → OpenAI ──────────────────────────────────────
// Both behind a single function. Keys come from env or Supabase Edge Function.
// For now, this calls a Supabase Edge Function that holds the keys server-side.

const AI_ENDPOINT = import.meta.env.VITE_AI_ENDPOINT || '/api/ai/chat';

/**
 * Send a message to the AI with full workspace context.
 * Returns { content, provider, model, actions, tokenCount }
 */
export async function sendAiMessage(messages, context, options = {}) {
  const { signal } = options;

  // Get the current user's auth token
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const res = await fetch(AI_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      messages,
      context,
    }),
    signal,
  });

  if (!res.ok) {
    // If endpoint fails, use mock fallback for development
    console.warn('AI endpoint failed, using mock response for development');
    return generateMockResponse(messages, context);
  }

  return res.json();
}

/**
 * Local fallback: if no server endpoint is configured,
 * use direct API calls (keys must be in env — NOT recommended for production).
 */
export async function sendDirectMessage(messages, systemPrompt) {
  const claudeKey = import.meta.env.VITE_CLAUDE_API_KEY;
  const openaiKey = import.meta.env.VITE_OPENAI_API_KEY;

  // Try Claude first
  if (claudeKey) {
    try {
      return await callClaude(messages, systemPrompt, claudeKey);
    } catch (err) {
      console.warn('Claude failed, falling back to OpenAI:', err.message);
    }
  }

  // Fallback to OpenAI
  if (openaiKey) {
    return await callOpenAI(messages, systemPrompt, openaiKey);
  }

  throw new Error('No AI provider configured. Set VITE_AI_ENDPOINT, VITE_CLAUDE_API_KEY, or VITE_OPENAI_API_KEY.');
}

async function callClaude(messages, systemPrompt, apiKey) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'prompt-caching-2024-07-31',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-20250514',
      max_tokens: 1500,
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: messages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Claude error ${res.status}`);
  }

  const data = await res.json();
  return {
    content: data.content[0]?.text || '',
    provider: 'claude',
    model: data.model,
    tokenCount: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
  };
}

async function callOpenAI(messages, systemPrompt, apiKey) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      max_tokens: 1500,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `OpenAI error ${res.status}`);
  }

  const data = await res.json();
  return {
    content: data.choices[0]?.message?.content || '',
    provider: 'openai',
    model: data.model,
    tokenCount: data.usage?.total_tokens || 0,
  };
}

// Mock response generator for development/testing when no real endpoint is available
function generateMockResponse(messages, context) {
  const lastMessage = messages[messages.length - 1]?.content?.toLowerCase() || '';
  
  let content = '';
  
  if (lastMessage.includes('create') && lastMessage.includes('task')) {
    content = `I'll create a task for you. Here's what I'm proposing:

📋 **New Task**
- Title: "${lastMessage.match(/task (?:called |named )?"([^"]+)"/)?.[1] || 'New Task'}"
- Status: To Do
- Priority: Medium
- Project: ${context.recentProjects?.[0]?.name || 'General'}

[ANKA_ACTION]{
  "type": "team.create_task",
  "description": "Create a new task",
  "params": {
    "title": "${lastMessage.match(/task (?:called |named )?"([^"]+)"/)?.[1] || 'New Task'}",
    "priority": "medium",
    "project_id": "${context.recentProjects?.[0]?.id || null}",
    "assignee": "${context.userId || null}"
  }
}[/ANKA_ACTION]`;
  } else if (lastMessage.includes('project')) {
    content = `I can help you with projects! Here are your current projects:

${context.recentProjects?.map(p => `- **${p.name}** (${p.status})`).join('\n') || '- No projects yet'}

What would you like to do with projects?`;
  } else if (lastMessage.includes('task')) {
    content = `Here are your tasks:

${context.myTasks?.map(t => `- [ ] ${t.title} (${t.status})`).join('\n') || '- No tasks assigned yet'}

Would you like to create, update, or complete a task?`;
  } else {
    content = `Hi! I'm Anka AI, your workspace assistant. I can help you:

✨ **What I can do:**
- Create tasks and projects
- Mark tasks as complete
- Flag blockers and issues
- Log team decisions
- Search and organize your work

Try asking me to "create a task called..." or "mark this as done"!`;
  }
  
  return {
    content,
    provider: 'mock',
    model: 'anka-ai-mock',
    tokenCount: 0,
  };
}
