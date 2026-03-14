import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useNotifications } from '../hooks/useNotifications.js';
import { usePresence } from '../hooks/usePresence.js';
import { useTheme } from '../hooks/useTheme.jsx';

export default function Taskbar({
  windows,
  activeWindowId,
  onFocus,
  onToggleLauncher,
  showLauncher,
}) {
  const { profile, signOut } = useAuth();
  const { notifications, unreadCount, markAsRead, markAllRead } = useNotifications();
  const { teamStatus, myStatus, onlineCount } = usePresence();
  const { theme, toggleTheme } = useTheme();
  const [time, setTime] = useState(new Date());
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const [showPresence, setShowPresence] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = time.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });

  const departmentLabel = {
    design: { emoji: '🎨', color: 'var(--anka-accent)' },
    development: { emoji: '⚡', color: '#60a5fa' },
    marketing: { emoji: '📣', color: '#f59e0b' },
  };

  const dept = departmentLabel[profile?.department] || departmentLabel.development;

  // Shared popup style
  const popupStyle = 'anka-glass-heavy anka-slide-up';

  return (
    <div
      className="anka-glass-heavy z-[9999]"
      style={{
        height: 52,
        borderTop: '1px solid var(--anka-border-subtle)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        gap: 6,
      }}
    >
      {/* Launcher button */}
      <button
        onClick={onToggleLauncher}
        className="cursor-pointer"
        title="App Launcher"
        style={{
          width: 38,
          height: 38,
          borderRadius: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: showLauncher ? 'var(--anka-accent)' : 'transparent',
          color: showLauncher ? 'white' : 'var(--anka-text-secondary)',
          transition: 'all 0.2s ease',
        }}
        onMouseEnter={(e) => { if (!showLauncher) e.currentTarget.style.background = 'var(--anka-bg-hover)'; }}
        onMouseLeave={(e) => { if (!showLauncher) e.currentTarget.style.background = 'transparent'; }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <rect x="1" y="1" width="6" height="6" rx="2" />
          <rect x="9" y="1" width="6" height="6" rx="2" />
          <rect x="1" y="9" width="6" height="6" rx="2" />
          <rect x="9" y="9" width="6" height="6" rx="2" />
        </svg>
      </button>

      {/* Subtle divider */}
      <div style={{ width: 1, height: 20, background: 'var(--anka-border)', margin: '0 4px' }} />

      {/* Open windows — pill style */}
      <div className="flex-1 flex items-center gap-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {windows.map((w) => {
          const isActive = w.id === activeWindowId;
          return (
            <button
              key={w.id}
              onClick={() => onFocus(w.id)}
              className="cursor-pointer shrink-0"
              style={{
                height: 34,
                padding: '0 12px',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                fontSize: 12,
                fontWeight: isActive ? 500 : 400,
                maxWidth: 180,
                overflow: 'hidden',
                color: isActive ? 'var(--anka-text-accent)' : 'var(--anka-text-secondary)',
                background: isActive ? 'var(--anka-accent-muted)' : 'transparent',
                opacity: w.minimized ? 0.45 : 1,
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--anka-bg-hover)'; }}
              onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
            >
              <span style={{ fontSize: 13, flexShrink: 0 }}>{w.icon}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.title}</span>
              {isActive && <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--anka-accent)', flexShrink: 0 }} />}
            </button>
          );
        })}
      </div>

      {/* Right side controls */}
      <div className="flex items-center gap-1">
        {/* Department chip */}
        {profile?.department && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              padding: '4px 10px',
              borderRadius: 100,
              background: 'var(--anka-accent-muted)',
              color: 'var(--anka-text-accent)',
              marginRight: 4,
            }}
          >
            {dept.emoji} {profile.department}
          </span>
        )}

        {/* Team presence */}
        <div className="relative">
          <button
            onClick={() => { setShowPresence((s) => !s); setShowNotifs(false); setShowUserMenu(false); }}
            className="cursor-pointer"
            title="Team online"
            style={{
              height: 34,
              padding: '0 10px',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'transparent',
              color: 'var(--anka-text-secondary)',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--anka-bg-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--anka-success)' }} />
            <span style={{ fontSize: 11, fontWeight: 500 }}>{onlineCount}</span>
          </button>

          {showPresence && (
            <div className={popupStyle} style={{
              position: 'absolute', bottom: 48, right: 0, width: 280, maxHeight: 320,
              borderRadius: 14, border: '1px solid var(--anka-border)', boxShadow: 'var(--anka-shadow-xl)',
              overflow: 'hidden', zIndex: 9999,
            }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--anka-border-subtle)' }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Team Status</span>
              </div>
              <div style={{ overflowY: 'auto', maxHeight: 260 }}>
                {teamStatus.length === 0 ? (
                  <div style={{ padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--anka-text-tertiary)' }}>
                    No team members online
                  </div>
                ) : (
                  teamStatus.map((member) => {
                    const statusColors = { online: 'var(--anka-success)', away: 'var(--anka-warning)', busy: 'var(--anka-danger)', offline: 'var(--anka-text-tertiary)' };
                    return (
                      <div key={member.user_id} style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid var(--anka-border-subtle)' }}>
                        <div style={{ position: 'relative' }}>
                          <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg, var(--anka-accent), #a78bfa)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, color: 'white' }}>
                            {member.full_name?.charAt(0)?.toUpperCase() || '?'}
                          </div>
                          <span style={{ position: 'absolute', bottom: -1, right: -1, width: 10, height: 10, borderRadius: '50%', border: '2px solid var(--anka-bg-secondary)', background: statusColors[member.status] || statusColors.offline }} />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{member.full_name}</div>
                          <div style={{ fontSize: 11, color: 'var(--anka-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {member.status_text || member.status}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          className="cursor-pointer"
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          style={{
            width: 34, height: 34, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'transparent', fontSize: 14, transition: 'all 0.2s ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--anka-bg-hover)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>

        {/* Notification bell */}
        <div className="relative">
          <button
            onClick={() => { setShowNotifs((s) => !s); setShowUserMenu(false); setShowPresence(false); }}
            className="cursor-pointer relative"
            title="Notifications"
            style={{
              width: 34, height: 34, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'transparent', fontSize: 14, transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--anka-bg-hover)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            🔔
            {unreadCount > 0 && (
              <span style={{
                position: 'absolute', top: 2, right: 2, minWidth: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 100, background: 'var(--anka-danger)', color: 'white', fontSize: 9, fontWeight: 700, padding: '0 4px',
              }}>
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {showNotifs && (
            <div className={popupStyle} style={{
              position: 'absolute', bottom: 48, right: 0, width: 340, maxHeight: 400,
              borderRadius: 14, border: '1px solid var(--anka-border)', boxShadow: 'var(--anka-shadow-xl)',
              overflow: 'hidden', zIndex: 9999,
            }}>
              <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--anka-border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Notifications</span>
                {unreadCount > 0 && (
                  <button onClick={markAllRead} className="cursor-pointer" style={{ fontSize: 11, color: 'var(--anka-accent)', background: 'none', border: 'none', fontWeight: 500 }}>
                    Mark all read
                  </button>
                )}
              </div>
              <div style={{ overflowY: 'auto', maxHeight: 340 }}>
                {notifications.length === 0 ? (
                  <div style={{ padding: 32, textAlign: 'center', fontSize: 12, color: 'var(--anka-text-tertiary)' }}>
                    No notifications yet
                  </div>
                ) : (
                  notifications.slice(0, 20).map((n) => (
                    <button
                      key={n.id}
                      onClick={() => markAsRead(n.id)}
                      className="cursor-pointer"
                      style={{
                        width: '100%', textAlign: 'left', padding: '12px 16px',
                        borderBottom: '1px solid var(--anka-border-subtle)',
                        background: !n.read ? 'var(--anka-accent-soft)' : 'transparent',
                        display: 'block', transition: 'all 0.15s ease', border: 'none',
                        color: 'inherit',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--anka-bg-hover)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = !n.read ? 'var(--anka-accent-soft)' : 'transparent'; }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                        {!n.read && <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--anka-accent)', flexShrink: 0, marginTop: 6 }} />}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.title}</div>
                          {n.body && <div style={{ fontSize: 11, color: 'var(--anka-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>{n.body}</div>}
                          <div style={{ fontSize: 10, color: 'var(--anka-text-tertiary)', marginTop: 4 }}>
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
        <div style={{ textAlign: 'right', lineHeight: 1.3, padding: '0 6px' }}>
          <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--anka-text-primary)', letterSpacing: '0.02em' }}>{timeStr}</div>
          <div style={{ fontSize: 10, color: 'var(--anka-text-tertiary)' }}>{dateStr}</div>
        </div>

        {/* User avatar / menu */}
        <div className="relative">
          <button
            onClick={() => { setShowUserMenu((s) => !s); setShowNotifs(false); setShowPresence(false); }}
            className="cursor-pointer"
            style={{
              width: 34, height: 34, borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--anka-accent), #a78bfa)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 700, color: 'white', position: 'relative',
              border: 'none', transition: 'all 0.2s ease',
              boxShadow: '0 0 0 0 var(--anka-accent-glow)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 0 0 3px var(--anka-accent-glow)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.boxShadow = '0 0 0 0 var(--anka-accent-glow)'; }}
          >
            {profile?.full_name?.charAt(0)?.toUpperCase() || '?'}
            <span style={{
              position: 'absolute', bottom: -1, right: -1, width: 10, height: 10, borderRadius: '50%',
              border: '2px solid var(--anka-bg-secondary)',
              background: myStatus === 'online' ? 'var(--anka-success)' : myStatus === 'away' ? 'var(--anka-warning)' : myStatus === 'busy' ? 'var(--anka-danger)' : 'var(--anka-text-tertiary)',
            }} />
          </button>

          {showUserMenu && (
            <div className={popupStyle} style={{
              position: 'absolute', bottom: 48, right: 0, width: 240,
              borderRadius: 14, border: '1px solid var(--anka-border)', boxShadow: 'var(--anka-shadow-xl)',
              overflow: 'hidden', zIndex: 9999, padding: 8,
            }}>
              <div style={{ padding: '12px', borderBottom: '1px solid var(--anka-border-subtle)', marginBottom: 6 }}>
                <div style={{ fontSize: 14, fontWeight: 600 }}>
                  {profile?.full_name || 'User'}
                </div>
                <div style={{ fontSize: 11, color: 'var(--anka-text-tertiary)', marginTop: 2 }}>
                  {profile?.role || 'member'} · {profile?.department || '—'}
                </div>
              </div>
              <button
                onClick={signOut}
                className="cursor-pointer"
                style={{
                  width: '100%', textAlign: 'left', padding: '10px 12px', fontSize: 13,
                  color: 'var(--anka-danger)', background: 'transparent', border: 'none',
                  borderRadius: 8, transition: 'all 0.15s ease',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--anka-danger-muted)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
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
