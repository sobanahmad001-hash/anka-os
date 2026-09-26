import { useState, useRef, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useOrganization } from '../context/OrganizationContext.jsx'
import { environmentNav, getEnvironmentFromPath, isNavigationItemActive, visibleEnvironmentItems } from '../config/environmentNav'
import { featureFlags } from '../config/featureFlags'
import { useNotifications } from '../hooks/useNotifications'
import AppearanceSelector from './AppearanceSelector.jsx'

export default function Header({ sidebarCollapsed = false, onToggleSidebar }) {
  const { profile, signOut } = useAuth()
  const { activeMembership, memberships, activeOrganizationId, selectionRequired, loading: organizationLoading, error: organizationError, selectOrganization } = useOrganization()
  const navigate = useNavigate()
  const location = useLocation()
  const [showNotifications, setShowNotifications] = useState(false)
  const [showMobileNav, setShowMobileNav] = useState(false)
  const notifRef = useRef(null)
  const mobileNavRef = useRef(null)
  const mobileToggleRef = useRef(null)
  const notificationToggleRef = useRef(null)
  const { notifications, unread, markRead, markAllRead } = useNotifications()

  const activeEnv = environmentNav.find(e => e.key === getEnvironmentFromPath(location.pathname))
  const mobileItems = visibleEnvironmentItems(activeEnv, {
    activeMembership,
    profileRole: profile?.role,
    aiAssistance: featureFlags.aiAssistance,
  })

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (notifRef.current && !notifRef.current.contains(e.target)) {
        setShowNotifications(false)
      }
      if (mobileNavRef.current && !mobileNavRef.current.contains(e.target) && !mobileToggleRef.current?.contains(e.target)) setShowMobileNav(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  useEffect(() => {
    function dismiss(event) {
      if (event.key !== 'Escape') return
      if (showNotifications) { setShowNotifications(false); notificationToggleRef.current?.focus() }
      else if (showMobileNav) { setShowMobileNav(false); mobileToggleRef.current?.focus() }
    }
    document.addEventListener('keydown', dismiss)
    return () => document.removeEventListener('keydown', dismiss)
  }, [showNotifications, showMobileNav])

  useEffect(() => {
    setShowMobileNav(false)
  }, [location.pathname])

  const NOTIF_ICONS = {
    task_assigned: '📋',
    task_status: '✓',
    request_assigned: '↗',
    request_status: '↻',
    review_required: '◎',
    client_revision: '↩',
    client_message: '💬',
    project_update: '⚡',
    system: '◆',
  }

  return (
    <header className="shell-header relative z-40 flex shrink-0 items-center gap-3 border-b px-3 sm:px-5">
      <button type="button" className="shell-sidebar-toggle hidden md:flex" aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!sidebarCollapsed} aria-controls="workspace-sidebar" onClick={onToggleSidebar}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg>
      </button>
      {/* Logo */}
      <div className="flex min-w-0 shrink-0 items-center gap-3 ">
        <div className="relative flex h-9 w-9 items-center justify-center rounded-xl  shell-brand-fill ">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="8" />
            <path d="M8.5 9.5 12 7l3.5 2.5v5L12 17l-3.5-2.5z" />
          </svg>
        </div>
        <div className="min-w-0">
          <span className="block truncate text-sm font-semibold tracking-tight shell-ink">Anka Sphere</span>
          <span className="hidden text-[11px] font-medium uppercase tracking-[0.15em] shell-muted lg:block">Creative delivery system</span>
        </div>
      </div>

      <button
        type="button"
        ref={mobileToggleRef}
        aria-label="Open workspace navigation"
        aria-expanded={showMobileNav}
        aria-controls="workspace-mobile-navigation"
        onClick={() => { setShowNotifications(false); setShowMobileNav((current) => !current) }}
        className="flex h-9 w-9 items-center justify-center rounded-xl border shell-line shell-muted md:hidden"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
      </button>

      {showMobileNav && (
        <nav ref={mobileNavRef} id="workspace-mobile-navigation" aria-label="Workspace navigation" className="shell-popover shell-mobile-navigation absolute left-3 right-3 overflow-y-auto rounded-xl border p-2 shadow-xl md:hidden">
          {environmentNav.filter(env => env.key !== 'admin' || profile?.role === 'admin').map(env => <button key={env.key} type="button" className="shell-environment-link" onClick={() => { navigate(env.basePath); setShowMobileNav(false) }}>{env.label}</button>)}
          <p className="px-3 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.16em] shell-muted">{activeEnv?.label}</p>
          {mobileItems.map((item) => {
            if (item.isHeader) return <p key={`header-${item.label}`} className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-[0.16em] shell-muted">{item.label}</p>
            const isCurrent = isNavigationItemActive(item, location.pathname)
            return <button type="button" key={item.path} aria-current={isCurrent ? 'page' : undefined} onClick={() => { navigate(item.path); setShowMobileNav(false) }} className={`block w-full rounded-xl px-3 py-2.5 text-left text-sm font-medium ${isCurrent ? 'bg-violet-500/15 text-violet-100' : 'shell-muted hover:bg-white/[0.05] hover:shell-ink'}`}>
              {item.label}
            </button>
          })}
        </nav>
      )}

      {/* Environment tabs */}
      <nav aria-label="Environments" className="hidden flex-1 items-center gap-1 md:flex">
        {environmentNav.map(env => {
          if (env.key === 'admin' && profile?.role !== 'admin') return null
          const isActive = activeEnv?.key === env.key
          return (
            <button
              key={env.key}
              type="button"
              aria-current={isActive ? 'page' : undefined}
              onClick={() => navigate(env.basePath)}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                isActive
                  ? 'bg-white/[0.07] shell-ink'
                  : 'shell-muted hover:bg-white/[0.04] hover:shell-ink'
              }`}>
              {env.label}
            </button>
          )
        })}
      </nav>

      {/* Right side */}
      <div className="shell-header-actions ml-auto flex items-center gap-2">
        <AppearanceSelector />

        <label className="min-w-0">
          <span className="sr-only">Active organization</span>
          <select aria-label="Active organization" value={activeOrganizationId || ''}
            disabled={organizationLoading || Boolean(organizationError) || memberships.length === 0}
            onChange={(event) => {
              const organizationId = event.target.value
              const change = new CustomEvent('anka:organization-change', { cancelable: true, detail: { organizationId } })
              if (window.dispatchEvent(change)) selectOrganization(organizationId)
            }}
            className="h-9 max-w-40 rounded-xl border shell-line bg-white/[0.025] px-2.5 text-xs font-medium shell-ink outline-none focus:border-violet-500/60 disabled:shell-muted sm:max-w-52">
            {organizationLoading && <option value="">Loading organizations...</option>}
            {organizationError && <option value="">Organizations unavailable</option>}
            {!organizationLoading && !organizationError && memberships.length === 0 && <option value="">No organizations</option>}
            {selectionRequired && <option value="">Choose organization</option>}
            {memberships.map(item => <option key={item.organizationId} value={item.organizationId}>{item.organization.name}</option>)}
          </select>
        </label>

        {/* Notification bell */}
        <div className="relative" ref={notifRef}>
          <button
            type="button"
            ref={notificationToggleRef}
            aria-expanded={showNotifications}
            aria-controls="workspace-notifications"
            onClick={() => { setShowMobileNav(false); setShowNotifications(current => !current) }}
            aria-label="Open notifications"
            className="relative flex h-9 w-9 items-center justify-center rounded-xl border shell-line bg-white/[0.025] shell-muted transition-colors hover:shell-line hover:bg-white/[0.06] hover:shell-ink">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            {unread > 0 && (
              <span className="shell-unread-badge absolute -top-0.5 -right-0.5 w-4 h-4 text-xs rounded-full flex items-center justify-center font-medium">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>

          {/* Dropdown */}
          {showNotifications && (
            <div id="workspace-notifications" className="shell-popover absolute right-0 top-12 z-50 w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border shadow-xl">
              <div className="flex items-center justify-between px-4 py-3 border-b shell-line">
                <p className="text-sm font-semibold shell-ink">Notifications</p>
                {notifications.some(n => !n.read) && (
                  <button onClick={markAllRead} className="text-xs text-purple-400 hover:text-purple-300">
                    Mark all read
                  </button>
                )}
              </div>

              <div className="max-h-96 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="py-8 text-center shell-muted">
                    <p className="text-2xl mb-2">🔔</p>
                    <p className="text-xs">No notifications yet</p>
                  </div>
                ) : (
                  notifications.map(notif => (
                    <button
                      key={notif.id}
                      onClick={() => {
                        markRead(notif.id)
                        if (notif.action_url) navigate(notif.action_url)
                        else if (notif.project_id) navigate('/sphere/workspace')
                        setShowNotifications(false)
                      }}
                      className={`w-full text-left px-4 py-3 border-b shell-line hover:bg-gray-700/50 transition-colors ${!notif.read ? 'bg-purple-900/10' : ''}`}>
                      <div className="flex items-start gap-3">
                        <span className="text-base flex-shrink-0 mt-0.5">
                          {NOTIF_ICONS[notif.type] || '🔔'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className={`text-xs font-medium truncate ${!notif.read ? 'shell-ink' : 'shell-ink'}`}>
                              {notif.title}
                            </p>
                            {!notif.read && (
                              <div className="w-1.5 h-1.5 rounded-full bg-purple-500 flex-shrink-0" />
                            )}
                          </div>
                          <p className="text-xs shell-muted mt-0.5 line-clamp-2">{notif.body}</p>
                          <p className="text-xs shell-muted mt-1">
                            {new Date(notif.created_at).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>

              {notifications.length > 0 && (
                <div className="px-4 py-2 border-t shell-line">
                  <p className="text-xs shell-muted text-center">{notifications.length} notifications</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* User info */}
        <div className="flex items-center gap-2 rounded-xl border shell-line bg-white/[0.025] py-1.5 pl-1.5 pr-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg  shell-brand-fill text-xs font-bold shell-ink">
            {(profile?.full_name || profile?.email || '?')[0].toUpperCase()}
          </div>
          <span className="hidden max-w-28 truncate text-xs font-medium shell-ink lg:block">
            {profile?.full_name || profile?.email?.split('@')[0]}
          </span>
        </div>

        <button onClick={signOut}
          aria-label="Sign out"
          title="Sign out"
          className="flex h-9 w-9 items-center justify-center rounded-xl shell-muted transition-colors hover:bg-white/[0.05] hover:shell-ink">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10 17l5-5-5-5M15 12H3"/><path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5"/>
          </svg>
        </button>
      </div>
    </header>
  )
}
