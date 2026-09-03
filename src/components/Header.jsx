import { useState, useRef, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { environmentNav } from '../config/environmentNav'
import { featureFlags } from '../config/featureFlags'
import { useNotifications } from '../hooks/useNotifications'

export default function Header() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [showNotifications, setShowNotifications] = useState(false)
  const [showMobileNav, setShowMobileNav] = useState(false)
  const notifRef = useRef(null)
  const { notifications, unread, markRead, markAllRead } = useNotifications()

  const activeEnv = environmentNav.find(e =>
    location.pathname.startsWith(e.basePath?.split('/').slice(0, 2).join('/') || '__') ||
    (e.key === 'admin' && (location.pathname.startsWith('/admin') || location.pathname === '/users' || location.pathname === '/settings'))
  )
  const mobileItems = (activeEnv?.items || []).filter((item) => {
    if (item.path === '/assistant' && !featureFlags.aiAssistance) return false
    if (activeEnv?.key === 'admin') return profile?.role === 'admin'
    return item.dept == null || profile?.role === 'admin' || profile?.department === item.dept
  })

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (notifRef.current && !notifRef.current.contains(e.target)) {
        setShowNotifications(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

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
    <header className="relative z-40 flex h-16 shrink-0 items-center gap-3 border-b border-white/[0.07] bg-[#0b0e15]/90 px-3 backdrop-blur-xl sm:px-5">
      {/* Logo */}
      <div className="flex min-w-0 shrink-0 items-center gap-3 md:w-[220px]">
        <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 shadow-[0_0_24px_rgba(124,58,237,0.22)]">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="8" />
            <path d="M8.5 9.5 12 7l3.5 2.5v5L12 17l-3.5-2.5z" />
          </svg>
        </div>
        <div className="min-w-0">
          <span className="block truncate text-sm font-semibold tracking-tight text-white">Anka OS</span>
          <span className="hidden text-[10px] font-medium uppercase tracking-[0.15em] text-slate-600 lg:block">Creative delivery system</span>
        </div>
      </div>

      <button
        type="button"
        aria-label="Open workspace navigation"
        aria-expanded={showMobileNav}
        onClick={() => setShowMobileNav((current) => !current)}
        className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.06] text-slate-400 sm:hidden"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
      </button>

      {showMobileNav && (
        <nav className="absolute left-3 right-3 top-[3.75rem] rounded-2xl border border-white/10 bg-[#141824] p-2 shadow-2xl sm:hidden">
          <p className="px-3 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">{activeEnv?.label}</p>
          {mobileItems.map((item) => item.isHeader ? (
            <p key={`header-${item.label}`} className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">{item.label}</p>
          ) : (
            <button type="button" key={item.path} onClick={() => navigate(item.path)} className={`block w-full rounded-xl px-3 py-2.5 text-left text-sm font-medium ${location.pathname === item.path ? 'bg-violet-500/15 text-violet-100' : 'text-slate-400 hover:bg-white/[0.05] hover:text-white'}`}>
              {item.label}
            </button>
          ))}
        </nav>
      )}

      {/* Environment tabs */}
      <nav className="hidden flex-1 items-center gap-1 sm:flex">
        {environmentNav.map(env => {
          if (env.key === 'admin' && profile?.role !== 'admin') return null
          const isActive = activeEnv?.key === env.key
          return (
            <button
              key={env.key}
              onClick={() => navigate(env.basePath)}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                isActive
                  ? 'bg-white/[0.07] text-white'
                  : 'text-slate-500 hover:bg-white/[0.04] hover:text-slate-200'
              }`}>
              {env.label}
            </button>
          )
        })}
      </nav>

      {/* Right side */}
      <div className="ml-auto flex shrink-0 items-center gap-2">

        {/* Notification bell */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => { setShowNotifications(!showNotifications); if (!showNotifications && unread > 0) markAllRead() }}
            aria-label="Open notifications"
            className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.025] text-slate-400 transition-colors hover:border-white/10 hover:bg-white/[0.06] hover:text-white">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            {unread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-purple-600 text-white text-xs rounded-full flex items-center justify-center font-medium">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>

          {/* Dropdown */}
          {showNotifications && (
            <div className="absolute right-0 top-12 z-50 w-[min(20rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-white/10 bg-[#141824] shadow-2xl">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
                <p className="text-sm font-semibold text-white">Notifications</p>
                {notifications.some(n => !n.read) && (
                  <button onClick={markAllRead} className="text-xs text-purple-400 hover:text-purple-300">
                    Mark all read
                  </button>
                )}
              </div>

              <div className="max-h-96 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="py-8 text-center text-gray-500">
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
                      className={`w-full text-left px-4 py-3 border-b border-gray-700/50 hover:bg-gray-700/50 transition-colors ${!notif.read ? 'bg-purple-900/10' : ''}`}>
                      <div className="flex items-start gap-3">
                        <span className="text-base flex-shrink-0 mt-0.5">
                          {NOTIF_ICONS[notif.type] || '🔔'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className={`text-xs font-medium truncate ${!notif.read ? 'text-white' : 'text-gray-300'}`}>
                              {notif.title}
                            </p>
                            {!notif.read && (
                              <div className="w-1.5 h-1.5 rounded-full bg-purple-500 flex-shrink-0" />
                            )}
                          </div>
                          <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{notif.body}</p>
                          <p className="text-xs text-gray-600 mt-1">
                            {new Date(notif.created_at).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>

              {notifications.length > 0 && (
                <div className="px-4 py-2 border-t border-gray-700">
                  <p className="text-xs text-gray-500 text-center">{notifications.length} notifications</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* User info */}
        <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.025] py-1.5 pl-1.5 pr-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 text-xs font-bold text-white">
            {(profile?.full_name || profile?.email || '?')[0].toUpperCase()}
          </div>
          <span className="hidden max-w-28 truncate text-xs font-medium text-slate-300 lg:block">
            {profile?.full_name || profile?.email?.split('@')[0]}
          </span>
        </div>

        <button onClick={signOut}
          aria-label="Sign out"
          title="Sign out"
          className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-white/[0.05] hover:text-white">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10 17l5-5-5-5M15 12H3"/><path d="M14 3h5a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-5"/>
          </svg>
        </button>
      </div>
    </header>
  )
}
