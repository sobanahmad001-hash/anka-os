import { useState, useRef, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { environmentNav } from '../config/environmentNav'
import { useNotifications } from '../hooks/useNotifications'

export default function Header() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [showNotifications, setShowNotifications] = useState(false)
  const notifRef = useRef(null)
  const { notifications, unread, markRead, markAllRead } = useNotifications()

  const activeEnv = environmentNav.find(e =>
    location.pathname.startsWith(e.basePath?.split('/').slice(0, 2).join('/') || '__') ||
    (e.key === 'admin' && (location.pathname.startsWith('/admin') || location.pathname === '/users' || location.pathname === '/settings'))
  )

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

  const NOTIF_ICONS = {
    task_assigned: '📋',
    handoff_requested: '🔄',
    handoff_approved: '✅',
    handoff_rejected: '❌',
    phase_changed: '⚡',
    client_signoff_requested: '✍️',
    deliverable_uploaded: '📎',
    comment: '💬',
    mention: '@',
  }

  return (
    <header className="h-14 border-b border-gray-800 bg-gray-900 flex items-center px-6 gap-6 shrink-0 z-40">
      {/* Logo */}
      <div className="flex items-center gap-2 flex-shrink-0">
        <div className="w-6 h-6 bg-purple-600 rounded-md flex items-center justify-center">
          <span className="text-white text-xs font-bold">A</span>
        </div>
        <span className="text-sm font-semibold text-white">Anka OS</span>
        <span className="text-xs text-gray-500 hidden md:block">Internal operating system for organized execution</span>
      </div>

      {/* Environment tabs */}
      <nav className="flex items-center gap-1 flex-1">
        {environmentNav.map(env => {
          if (env.key === 'admin' && profile?.role !== 'admin') return null
          const isActive = activeEnv?.key === env.key
          return (
            <button
              key={env.key}
              onClick={() => navigate(env.basePath)}
              className={`px-4 py-1.5 text-sm rounded-lg transition-colors ${
                isActive
                  ? 'bg-gray-700 text-white font-medium'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              }`}>
              {env.label}
            </button>
          )
        })}
      </nav>

      {/* Right side */}
      <div className="flex items-center gap-3 flex-shrink-0">

        {/* Notification bell */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={() => { setShowNotifications(!showNotifications); if (!showNotifications && unread > 0) markAllRead() }}
            className="relative w-8 h-8 flex items-center justify-center text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors">
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
            <div className="absolute right-0 top-10 w-80 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl z-50 overflow-hidden">
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
                        if (notif.project_id) navigate(`/sphere/projects`)
                        setShowNotifications(false)
                      }}
                      className={`w-full text-left px-4 py-3 border-b border-gray-700/50 hover:bg-gray-700/50 transition-colors ${!notif.read ? 'bg-purple-900/10' : ''}`}>
                      <div className="flex items-start gap-3">
                        <span className="text-base flex-shrink-0 mt-0.5">
                          {NOTIF_ICONS[notif.notification_type] || '🔔'}
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
                          <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{notif.message}</p>
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
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-purple-600 flex items-center justify-center text-xs font-bold text-white">
            {(profile?.full_name || profile?.email || '?')[0].toUpperCase()}
          </div>
          <span className="text-sm text-gray-300 hidden md:block">
            {profile?.full_name || profile?.email?.split('@')[0]}
          </span>
        </div>

        <button onClick={signOut}
          className="text-xs text-gray-400 hover:text-white px-3 py-1.5 rounded-lg hover:bg-gray-800 transition-colors">
          Sign Out
        </button>
      </div>
    </header>
  )
}
