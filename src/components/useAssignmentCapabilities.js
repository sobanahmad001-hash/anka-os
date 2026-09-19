import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { readAssignmentCapabilities } from '../data/assignmentCapabilities'

export function useAssignmentCapabilities(organizationId, projectId, revision) {
  const [state, setState] = useState({ data: null, error: '' })
  useEffect(() => {
    const controller = new AbortController()
    setState({ data: null, error: '' })
    if (!organizationId || !projectId) return () => controller.abort()
    readAssignmentCapabilities(supabase, organizationId, projectId, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setState({ data, error: '' }) })
      .catch(error => { if (!controller.signal.aborted) setState({ data: null, error: error.message || 'Assignment capabilities unavailable' }) })
    return () => controller.abort()
  }, [organizationId, projectId, revision])
  return state.data?.organization_id === organizationId && state.data?.project_id === projectId ? state : { data: null, error: state.error }
}
