import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'

export function useNotifications() {
  const { user } = useAuth()
  const [notifications, setNotifications] = useState([])
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    if (!user?.id) return
    fetchNotifications()

    // Real-time subscription
    const channel = supabase
      .channel('notifications')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'as_notifications',
        filter: `recipient_id=eq.${user.id}`
      }, payload => {
        setNotifications(prev => [payload.new, ...prev.slice(0, 19)])
        setUnread(prev => prev + 1)
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [user?.id])

  async function fetchNotifications() {
    const { data } = await supabase
      .from('as_notifications')
      .select('*')
      .eq('recipient_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20)
    setNotifications(data || [])
    setUnread((data || []).filter(n => !n.read).length)
  }

  async function markRead(id) {
    await supabase.from('as_notifications').update({ read: true }).eq('id', id)
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
    setUnread(prev => Math.max(0, prev - 1))
  }

  async function markAllRead() {
    await supabase.from('as_notifications')
      .update({ read: true })
      .eq('recipient_id', user.id)
      .eq('read', false)
    setNotifications(prev => prev.map(n => ({ ...n, read: true })))
    setUnread(0)
  }

  return { notifications, unread, markRead, markAllRead, fetchNotifications }
}

// Helper — call this from anywhere to create a notification
export async function createNotification(recipientId, type, title, message, projectId = null) {
  if (!recipientId) return
  await supabase.from('as_notifications').insert({
    recipient_id: recipientId,
    notification_type: type,
    title,
    message,
    project_id: projectId,
    read: false
  })
}
