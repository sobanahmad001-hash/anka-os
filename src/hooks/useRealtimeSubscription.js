import { useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function useRealtimeSubscription(table, callback) {
  useEffect(() => {
    const channel = supabase
      .channel(`${table}_changes`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        callback
      )
      .subscribe()
    
    return () => {
      supabase.removeChannel(channel)
    }
  }, [table, callback])
}
