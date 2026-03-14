import { useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * Hook for logging user behavior events.
 * Used by Desktop and individual apps to build cognitive awareness.
 */
export function useBehaviorLog() {
  const { user } = useAuth();
  const sessionId = useRef(
    sessionStorage.getItem('anka_session') || (() => {
      const id = crypto.randomUUID();
      sessionStorage.setItem('anka_session', id);
      return id;
    })(),
  );

  const log = useCallback(
    async (eventType, appId = null, metadata = {}) => {
      if (!user) return;
      await supabase.from('behavior_logs').insert([{
        user_id: user.id,
        event_type: eventType,
        app_id: appId,
        metadata,
        session_id: sessionId.current,
      }]);
    },
    [user],
  );

  return { log };
}
