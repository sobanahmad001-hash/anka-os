import { supabase } from './supabase.js';

/**
 * Parse [ANKA_ACTION] blocks from AI response text.
 * Returns { cleanText, actions[] }
 */
export function parseActions(text) {
  const actionRegex = /\[ANKA_ACTION\]\s*([\s\S]*?)\s*\[\/ANKA_ACTION\]/g;
  const actions = [];
  let match;

  while ((match = actionRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.type && parsed.data) {
        actions.push({
          id: crypto.randomUUID(),
          ...parsed,
          status: 'pending',
        });
      }
    } catch {
      // Skip malformed action blocks
    }
  }

  // Remove action blocks from display text
  const cleanText = text.replace(actionRegex, '').trim();

  return { cleanText, actions };
}

/**
 * Execute an approved action against Supabase.
 * Returns { success, result, error }
 */
export async function executeAction(action, userId) {
  const { type, data } = action;

  try {
    switch (type) {
      case 'create_task': {
        const { error, data: result } = await supabase
          .from('tasks')
          .insert([{
            title: data.title,
            description: data.description || '',
            priority: data.priority || 'medium',
            due_date: data.due_date || null,
            project_id: data.project_id || null,
            user_id: userId,
            status: 'todo',
          }])
          .select()
          .single();
        if (error) throw error;
        return { success: true, result };
      }

      case 'update_task': {
        const updates = {};
        if (data.status) updates.status = data.status;
        if (data.priority) updates.priority = data.priority;
        if (data.due_date !== undefined) updates.due_date = data.due_date;
        if (data.title) updates.title = data.title;

        const { error } = await supabase
          .from('tasks')
          .update(updates)
          .eq('id', data.id);
        if (error) throw error;
        return { success: true, result: { id: data.id, ...updates } };
      }

      case 'create_project': {
        const { error, data: result } = await supabase
          .from('projects')
          .insert([{
            name: data.name,
            description: data.description || '',
            department_id: data.department_id,
            priority: data.priority || 'medium',
            owner_id: userId,
            start_date: data.start_date || null,
            due_date: data.due_date || null,
          }])
          .select()
          .single();
        if (error) throw error;
        return { success: true, result };
      }

      case 'update_project': {
        const updates = {};
        if (data.status) updates.status = data.status;
        if (data.priority) updates.priority = data.priority;
        if (data.name) updates.name = data.name;
        updates.updated_at = new Date().toISOString();

        const { error } = await supabase
          .from('projects')
          .update(updates)
          .eq('id', data.id);
        if (error) throw error;
        return { success: true, result: { id: data.id, ...updates } };
      }

      case 'create_decision': {
        const { error, data: result } = await supabase
          .from('decisions')
          .insert([{
            title: data.title,
            description: data.description || '',
            project_id: data.project_id || null,
            user_id: userId,
            tags: data.tags || [],
          }])
          .select()
          .single();
        if (error) throw error;
        return { success: true, result };
      }

      case 'send_notification': {
        const { error } = await supabase
          .from('notifications')
          .insert([{
            user_id: data.target_user_id || userId,
            type: data.type || 'info',
            title: data.title,
            body: data.body || '',
          }]);
        if (error) throw error;
        return { success: true, result: { sent: true } };
      }

      case 'add_client': {
        const { error, data: result } = await supabase
          .from('clients')
          .insert([{
            name: data.name,
            email: data.email || null,
            company: data.company || '',
            industry: data.industry || '',
            status: data.status || 'lead',
            owner_id: userId,
          }])
          .select()
          .single();
        if (error) throw error;
        return { success: true, result };
      }

      default:
        return { success: false, error: `Unknown action type: ${type}` };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}

/**
 * Log an action to the audit trail.
 */
export async function logAction(userId, conversationId, action, status, result) {
  await supabase.from('action_audit').insert([{
    user_id: userId,
    conversation_id: conversationId,
    action_type: action.type,
    action_payload: action,
    status,
    result: result || null,
    resolved_at: ['approved', 'rejected', 'executed', 'failed'].includes(status)
      ? new Date().toISOString()
      : null,
  }]);
}

/**
 * Action type display helpers
 */
export const ACTION_LABELS = {
  create_task: '📝 Create Task',
  update_task: '✏️ Update Task',
  create_project: '📋 Create Project',
  update_project: '📋 Update Project',
  create_decision: '🎯 Log Decision',
  send_notification: '🔔 Send Notification',
  add_client: '🤝 Add Client',
};

export const ACTION_COLORS = {
  create_task: 'border-blue-500/30 bg-blue-500/5',
  update_task: 'border-yellow-500/30 bg-yellow-500/5',
  create_project: 'border-green-500/30 bg-green-500/5',
  update_project: 'border-green-500/30 bg-green-500/5',
  create_decision: 'border-purple-500/30 bg-purple-500/5',
  send_notification: 'border-orange-500/30 bg-orange-500/5',
  add_client: 'border-pink-500/30 bg-pink-500/5',
};
