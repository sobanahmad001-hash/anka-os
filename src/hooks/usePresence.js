import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

/**
 * Hook for managing user presence (online/away/busy/offline).
 * Broadcasts own status and subscribes to team status changes.
 */
export function usePresence() {
  const { user, profile } = useAuth();
  const [teamStatus, setTeamStatus] = useState([]);
  const [myStatus, setMyStatus] = useState('online');

  // Upsert own status on mount
  useEffect(() => {
    if (!user) return;

    async function setOnline() {
      await supabase.from('user_status').upsert(
        { user_id: user.id, status: 'online', last_seen_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );
    }
    setOnline();

    // Heartbeat every 60s
    const heartbeat = setInterval(() => {
      supabase.from('user_status').upsert(
        { user_id: user.id, status: myStatus, last_seen_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );
    }, 60000);

    // Set offline on unload
    function handleUnload() {
      navigator.sendBeacon && supabase.from('user_status').update({ status: 'offline' }).eq('user_id', user.id);
    }
    window.addEventListener('beforeunload', handleUnload);

    return () => {
      clearInterval(heartbeat);
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, [user, myStatus]);

  // Load team status
  const loadTeamStatus = useCallback(async () => {
    if (!user || !profile) return;
    const { data } = await supabase
      .from('user_status')
      .select('user_id, status, status_text, last_seen_at')
      .neq('user_id', user.id);

    if (data) {
      // Enrich with profile names
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, department, role')
        .in('id', data.map((s) => s.user_id));

      const profileMap = {};
      (profiles || []).forEach((p) => { profileMap[p.id] = p; });

      setTeamStatus(
        data.map((s) => ({
          ...s,
          full_name: profileMap[s.user_id]?.full_name || 'Unknown',
          department: profileMap[s.user_id]?.department || '',
        })),
      );
    }
  }, [user, profile]);

  useEffect(() => {
    loadTeamStatus();

    if (!user) return;

    const channel = supabase
      .channel('team-presence')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_status' },
        () => { loadTeamStatus(); },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [user, loadTeamStatus]);

  const updateStatus = useCallback(async (status, statusText = '') => {
    if (!user) return;
    setMyStatus(status);
    await supabase.from('user_status').upsert(
      { user_id: user.id, status, status_text: statusText, last_seen_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    );
  }, [user]);

  const onlineCount = teamStatus.filter((s) => s.status === 'online' || s.status === 'busy').length;

  return { teamStatus, myStatus, updateStatus, onlineCount, reload: loadTeamStatus };
}
