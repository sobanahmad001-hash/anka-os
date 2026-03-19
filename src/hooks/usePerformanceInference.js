import { useCallback } from 'react'
import { supabase } from '../lib/supabase.js'

function getWeekStart(date = new Date()) {
  const d = new Date(date)
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  d.setHours(0, 0, 0, 0)
  return d.toISOString().split('T')[0]
}

function getPrevWeekStart() {
  const d = new Date()
  d.setDate(d.getDate() - 7)
  return getWeekStart(d)
}

export function usePerformanceInference() {

  const computeUserSnapshot = useCallback(async (userId) => {
    const weekStart = getWeekStart()
    const weekEnd = new Date()
    weekEnd.setHours(23, 59, 59, 999)
    const weekStartDate = new Date(weekStart)

    // Fetch all needed data in parallel
    const [behaviorRes, tasksRes] = await Promise.all([
      supabase.from('behavior_logs')
        .select('created_at, event_type, app_id, session_id')
        .eq('user_id', userId)
        .gte('created_at', weekStart)
        .order('created_at'),
      supabase.from('tasks')
        .select('id, status, due_date, created_at, updated_at, assigned_to, assigned_by')
        .eq('assigned_to', userId)
    ])

    const logs = behaviorRes.data || []
    const tasks = tasksRes.data || []

    // Activity days — unique days with any log event this week
    const activeDays = new Set(
      logs.map(l => new Date(l.created_at).toISOString().split('T')[0])
    ).size

    // Tasks this week
    const completedThisWeek = tasks.filter(t =>
      t.status === 'done' &&
      t.updated_at &&
      new Date(t.updated_at) >= weekStartDate
    ).length

    const assigned = tasks.length
    const completed = tasks.filter(t => t.status === 'done').length
    const blocked = tasks.filter(t => t.status === 'blocked').length
    const overdue = tasks.filter(t =>
      t.due_date &&
      new Date(t.due_date) < new Date() &&
      t.status !== 'done'
    ).length

    const completionRate = assigned > 0 ? Math.round((completed / assigned) * 100) : 0
    const blockerRate = assigned > 0 ? Math.round((blocked / assigned) * 100) : 0
    const overdueRate = assigned > 0 ? Math.round((overdue / assigned) * 100) : 0

    // Avg response hours — time from task created to status changing from todo
    const inProgressTasks = tasks.filter(t =>
      t.status !== 'todo' && t.created_at && t.updated_at
    )
    let avgResponseHours = null
    if (inProgressTasks.length > 0) {
      const totalHours = inProgressTasks.reduce((sum, t) => {
        const created = new Date(t.created_at)
        const updated = new Date(t.updated_at)
        return sum + Math.max(0, (updated - created) / (1000 * 60 * 60))
      }, 0)
      avgResponseHours = Math.round(totalHours / inProgressTasks.length)
    }

    const snapshot = {
      user_id: userId,
      week_start: weekStart,
      activity_days: activeDays,
      tasks_completed: completedThisWeek,
      tasks_assigned: assigned,
      tasks_blocked: blocked,
      tasks_overdue: overdue,
      avg_response_hours: avgResponseHours,
      completion_rate: completionRate,
      blocker_rate: blockerRate,
      computed_at: new Date().toISOString()
    }

    // Upsert snapshot
    await supabase.from('user_performance_snapshots').upsert(snapshot, {
      onConflict: 'user_id,week_start'
    })

    return snapshot
  }, [])

  const computeAllSnapshots = useCallback(async (userIds) => {
    const results = await Promise.all(userIds.map(id => computeUserSnapshot(id)))
    return results
  }, [computeUserSnapshot])

  const getSnapshots = useCallback(async (userIds) => {
    const weekStart = getWeekStart()
    const prevWeekStart = getPrevWeekStart()

    const [currentRes, prevRes] = await Promise.all([
      supabase.from('user_performance_snapshots')
        .select('*')
        .in('user_id', userIds)
        .eq('week_start', weekStart),
      supabase.from('user_performance_snapshots')
        .select('*')
        .in('user_id', userIds)
        .eq('week_start', prevWeekStart)
    ])

    const current = currentRes.data || []
    const prev = prevRes.data || []

    // Merge current with prev week trend
    return current.map(snap => {
      const prevSnap = prev.find(p => p.user_id === snap.user_id)
      const trend = prevSnap
        ? snap.tasks_completed > prevSnap.tasks_completed ? 'up'
          : snap.tasks_completed < prevSnap.tasks_completed ? 'down' : 'flat'
        : 'new'
      return { ...snap, trend, prev: prevSnap || null }
    })
  }, [])

  return { computeUserSnapshot, computeAllSnapshots, getSnapshots }
}
