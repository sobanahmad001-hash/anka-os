import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useNotifications } from '../hooks/useNotifications.js';

export default function Taskbar({
  windows,
  activeWindowId,
  onFocus,
  onToggleLauncher,
  showLauncher,
}) {
  const { profile, signOut } = useAuth();
  const { notifications, unreadCount, markAsRead, markAllRead } = useNotifications();
  const [time, setTime] = useState(new Date());
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = time.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

  const departmentColors = {
    design: 'from-pink-500 to-purple-500',
    development: 'from-blue-500 to-cyan-500',
    marketing: 'from-orange-500 to-yellow-500',
  };

  const gradientClass =
    departmentColors[profile?.department] || departmentColors.development;

  return (
    <div className="h-14 bg-[var(--anka-bg-secondary)]/95 backdrop-blur-xl border-t border-[var(--anka-border)] flex items-center px-3 gap-2 z-[9999]">
      {/* Start / Launcher button */}
      <button
        onClick={onToggleLauncher}
        className={`h-10 w-10 rounded-xl flex items-center justify-center transition cursor-pointer ${
          showLauncher
            ? 'bg-[var(--anka-accent)]'
            : 'hover:bg-[var(--anka-bg-tertiary)]'
        }`}
        title="App Launcher"
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
          <rect x="1" y="1" width="7" height="7" rx="1.5" />
          <rect x="10" y="1" width="7" height="7" rx="1.5" />
          <rect x="1" y="10" width="7" height="7" rx="1.5" />
          <rect x="10" y="10" width="7" height="7" rx="1.5" />
        </svg>
      </button>

      {/* Separator */}
      <div className="w-px h-6 bg-[var(--anka-border)]" />

      {/* Open windows */}
      <div className="flex-1 flex items-center gap-1 overflow-x-auto">
        {windows.map((w) => (
          <button
            key={w.id}
            onClick={() => onFocus(w.id)}
            className={`h-9 px-3 rounded-lg flex items-center gap-2 text-xs transition truncate max-w-48 cursor-pointer ${
              w.id === activeWindowId
                ? 'bg-[var(--anka-accent)]/20 text-[var(--anka-accent)]'
                : 'hover:bg-[var(--anka-bg-tertiary)] text-[var(--anka-text-secondary)]'
            } ${w.minimized ? 'opacity-50' : ''}`}
          >
            <span>{w.icon}</span>
            <span className="truncate">{w.title}</span>
          </button>
        ))}
      </div>

      {/* Right side — department badge, notifications, time, user */}
      <div className="flex items-center gap-3">
        {/* Department badge */}
        {profile?.department && (
          <span
            className={`text-[10px] font-semibold uppercase px-2 py-1 rounded-full bg-gradient-to-r ${gradientClass} text-white`}
          >
            {profile.department}
          </span>
        )}

        {/* Notification bell */}
        <div className="relative">
          <button
            onClick={() => { setShowNotifs((s) => !s); setShowUserMenu(false); }}
            className="h-9 w-9 rounded-lg hover:bg-[var(--anka-bg-tertiary)] flex items-center justify-center transition cursor-pointer relative"
            title="Notifications"
          >
            <span className="text-sm">🔔</span>
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 flex items-center justify-center bg-red-500 text-white text-[9px] font-bold rounded-full px-1">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {showNotifs && (
            <div className="absolute bottom-12 right-0 w-80 max-h-96 bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl shadow-2xl overflow-hidden z-[9999]">
              <div className="px-3 py-2 border-b border-[var(--anka-border)] flex items-center justify-between">
                <span className="text-xs font-semibold">Notifications</span>
                {unreadCount > 0 && (
                  <button
                    onClick={markAllRead}
                    className="text-[10px] text-[var(--anka-accent)] hover:text-[var(--anka-accent-hover)] cursor-pointer"
                  >
                    Mark all read
                  </button>
                )}
              </div>
              <div className="overflow-y-auto max-h-72">
                {notifications.length === 0 ? (
                  <div className="p-4 text-center text-xs text-[var(--anka-text-secondary)]">
                    No notifications yet
                  </div>
                ) : (
                  notifications.slice(0, 20).map((n) => (
                    <button
                      key={n.id}
                      onClick={() => { markAsRead(n.id); }}
                      className={`w-full text-left px-3 py-2.5 border-b border-[var(--anka-border)] last:border-0 hover:bg-[var(--anka-bg-tertiary)] transition cursor-pointer ${
                        !n.read ? 'bg-[var(--anka-accent)]/5' : ''
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        {!n.read && <span className="w-1.5 h-1.5 rounded-full bg-[var(--anka-accent)] shrink-0 mt-1.5" />}
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate">{n.title}</div>
                          {n.body && <div className="text-[10px] text-[var(--anka-text-secondary)] truncate">{n.body}</div>}
                          <div className="text-[9px] text-[var(--anka-text-secondary)] mt-0.5">
                            {new Date(n.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Time / Date */}
        <div className="text-right leading-tight">
          <div className="text-xs font-medium">{timeStr}</div>
          <div className="text-[10px] text-[var(--anka-text-secondary)]">{dateStr}</div>
        </div>

        {/* User avatar / menu */}
        <div className="relative">
          <button
            onClick={() => { setShowUserMenu((s) => !s); setShowNotifs(false); }}
            className="h-9 w-9 rounded-full bg-gradient-to-br from-[var(--anka-accent)] to-purple-500 flex items-center justify-center text-xs font-bold cursor-pointer"
          >
            {profile?.full_name?.charAt(0)?.toUpperCase() || '?'}
          </button>

          {showUserMenu && (
            <div className="absolute bottom-12 right-0 w-56 bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-3 shadow-2xl">
              <div className="mb-3 pb-3 border-b border-[var(--anka-border)]">
                <div className="font-medium text-sm">
                  {profile?.full_name || 'User'}
                </div>
                <div className="text-xs text-[var(--anka-text-secondary)]">
                  {profile?.role || 'member'} · {profile?.department || '—'}
                </div>
              </div>
              <button
                onClick={signOut}
                className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 rounded-lg transition cursor-pointer"
              >
                Sign Out
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
