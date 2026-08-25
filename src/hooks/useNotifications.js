import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext.jsx'
import { supabase } from '../lib/supabase.js'

export function useNotifications() {
  const { user } = useAuth()
  const [notifications, setNotifications] = useState([])
  const [unread, setUnread] = useState(0)

  useEffect(() => {
    if (!user?.id) return undefined
    fetchNotifications()

    const channel = supabase.channel(`notifications-${user.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${user.id}`,
      }, payload => {
        setNotifications(current => [payload.new, ...current].slice(0, 30))
        setUnread(current => current + 1)
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [user?.id])

  async function fetchNotifications() {
    if (!user?.id) return
    const { data, error } = await supabase.from('notifications')
      .select('*').eq('user_id', user.id).is('archived_at', null)
      .order('created_at', { ascending: false }).limit(30)
    if (error) return
    setNotifications(data || [])
    setUnread((data || []).filter(item => !item.read).length)
  }

  async function markRead(id) {
    const readAt = new Date().toISOString()
    const { error } = await supabase.from('notifications')
      .update({ read: true, read_at: readAt }).eq('id', id).eq('user_id', user.id)
    if (error) return
    setNotifications(current => current.map(item => item.id === id ? { ...item, read: true, read_at: readAt } : item))
    setUnread(current => Math.max(0, current - 1))
  }

  async function markAllRead() {
    if (!user?.id || unread === 0) return
    const readAt = new Date().toISOString()
    const { error } = await supabase.from('notifications')
      .update({ read: true, read_at: readAt })
      .eq('user_id', user.id).eq('read', false)
    if (error) return
    setNotifications(current => current.map(item => ({ ...item, read: true, read_at: readAt })))
    setUnread(0)
  }

  return {
    notifications,
    unread,
    unreadCount: unread,
    markRead,
    markAsRead: markRead,
    markAllRead,
    fetchNotifications,
  }
}
