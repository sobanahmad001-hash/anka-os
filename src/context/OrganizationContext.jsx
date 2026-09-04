import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from './AuthContext.jsx'
import { createLatestRequestGuard, createOrganizationScopeRepository, createOrganizationSelectionStorage, isOrganizationAccessError, resolveOrganizationSelection } from '../data/organizationScope.js'

const OrganizationContext = createContext(null)
const EMPTY = { userId: null, memberships: [], activeOrganizationId: null, selectionRequired: false, loading: false, error: null }
function browserStorage() { try { return globalThis.localStorage } catch { return null } }

export function OrganizationProvider({ children, client = supabase, storage = browserStorage() }) {
  const { user } = useAuth()
  const userId = user?.id || null
  const repository = useMemo(() => createOrganizationScopeRepository(client), [client])
  const selections = useMemo(() => createOrganizationSelectionStorage(storage), [storage])
  const guard = useRef(createLatestRequestGuard())
  const membershipAbort = useRef(null)
  const scopeAbort = useRef(new AbortController())
  const previousUserId = useRef(null)
  const [state, setState] = useState(EMPTY)
  const [scopeRevision, setScopeRevision] = useState(0)

  const resetScope = useCallback((organizationId = null) => {
    scopeAbort.current.abort()
    scopeAbort.current = new AbortController()
    if (!organizationId) scopeAbort.current.abort()
    setScopeRevision(value => value + 1)
  }, [])

  const refreshMemberships = useCallback(async () => {
    if (!userId) return []
    membershipAbort.current?.abort()
    const controller = new AbortController()
    membershipAbort.current = controller
    const generation = guard.current.begin()
    resetScope()
    setState(current => ({ ...current, userId, activeOrganizationId: null, selectionRequired: false, loading: true, error: null }))
    try {
      const memberships = await repository.listActiveTeamMemberships(userId, { signal: controller.signal })
      if (controller.signal.aborted || !guard.current.isCurrent(generation)) return []
      const resolved = resolveOrganizationSelection({ memberships, storedOrganizationId: selections.read(userId) })
      if (resolved.staleSelection) selections.clear(userId)
      if (resolved.activeOrganizationId) { selections.write(userId, resolved.activeOrganizationId); resetScope(resolved.activeOrganizationId) }
      setState({ userId, memberships, activeOrganizationId: resolved.activeOrganizationId, selectionRequired: resolved.selectionRequired, loading: false, error: null })
      return memberships
    } catch (error) {
      if (controller.signal.aborted || !guard.current.isCurrent(generation)) return []
      setState({ ...EMPTY, userId, error })
      return []
    }
  }, [repository, resetScope, selections, userId])

  useEffect(() => {
    const prior = previousUserId.current
    if (prior && prior !== userId) selections.clear(prior)
    previousUserId.current = userId
    membershipAbort.current?.abort()
    guard.current.invalidate()
    if (!userId) { resetScope(); setState(EMPTY); return undefined }
    refreshMemberships()
    return () => membershipAbort.current?.abort()
  }, [refreshMemberships, resetScope, selections, userId])

  const selectOrganization = useCallback((organizationId) => {
    const membership = state.memberships.find(item => item.organizationId === organizationId)
    if (!membership) {
      selections.clear(userId)
      refreshMemberships()
      throw Object.assign(new Error('Active organization membership is required'), { status: 403 })
    }
    if (organizationId !== state.activeOrganizationId) {
      selections.write(userId, organizationId)
      resetScope(organizationId)
      setState(current => ({ ...current, activeOrganizationId: organizationId, selectionRequired: false, error: null }))
    }
    return membership.organization
  }, [refreshMemberships, resetScope, selections, state.activeOrganizationId, state.memberships, userId])

  const handleOrganizationAccessError = useCallback((error, { membershipMismatch = false } = {}) => {
    if (!membershipMismatch && !isOrganizationAccessError(error)) return false
    refreshMemberships()
    return true
  }, [refreshMemberships])

  const effectiveState = useMemo(() => (
    state.userId === userId ? state : { ...EMPTY, userId, loading: Boolean(userId) }
  ), [state, userId])
  const activeMembership = effectiveState.memberships.find(item => item.organizationId === effectiveState.activeOrganizationId) || null
  const value = useMemo(() => ({ ...effectiveState, activeMembership, activeOrganization: activeMembership?.organization || null, selectOrganization, refreshMemberships, handleOrganizationAccessError, scopeRevision, requestSignal: scopeAbort.current.signal }), [activeMembership, effectiveState, handleOrganizationAccessError, refreshMemberships, scopeRevision, selectOrganization])
  return <OrganizationContext.Provider value={value}>{children}</OrganizationContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useOrganization() {
  const value = useContext(OrganizationContext)
  if (!value) throw new Error('useOrganization must be used within OrganizationProvider')
  return value
}
