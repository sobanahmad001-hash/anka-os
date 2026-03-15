import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

const CORE_APPS = [
  { name: 'Dashboard', path: '/dashboard', icon: '📊', roles: ['all'] },
  { name: 'Projects', path: '/projects', icon: '📁', roles: ['all'] },
  { name: 'Tasks', path: '/tasks', icon: '✓', roles: ['all'] },
  { name: 'Chat', path: '/chat', icon: '💬', roles: ['all'] },
  { name: 'Files', path: '/files', icon: '📄', roles: ['all'] },
  { name: 'Calendar', path: '/calendar', icon: '📅', roles: ['all'] },
  { name: 'Time Tracker', path: '/time-tracker', icon: '⏱️', roles: ['all'] },
  { name: 'Clients', path: '/clients', icon: '🤝', roles: ['admin', 'department_head', 'marketing'] },
  { name: 'Campaigns', path: '/campaigns', icon: '📢', roles: ['admin', 'department_head', 'marketing'] },
  { name: 'Settings', path: '/settings', icon: '⚙️', roles: ['all'] },
];

export default function Sidebar() {
  const location = useLocation();
  const { profile, signOut } = useAuth();

  const role = profile?.role || '';
  const department = profile?.department || '';

  const visibleApps = CORE_APPS.filter((app) =>
    app.roles.includes('all') ||
    app.roles.includes(role) ||
    app.roles.includes(department)
  );

  return (
    <aside style={{
      width: 240,
      background: 'var(--anka-bg-secondary)',
      borderRight: '1px solid var(--anka-border)',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
    }}>
      {/* Logo */}
      <div style={{
        padding: '20px 16px 16px',
        borderBottom: '1px solid var(--anka-border)',
      }}>
        <div style={{
          fontSize: 20,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          background: 'linear-gradient(135deg, var(--anka-accent), #a78bfa)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}>
          Anka OS
        </div>
        {profile && (
          <div style={{
            marginTop: 6,
            fontSize: 11,
            color: 'var(--anka-text-tertiary)',
          }}>
            {profile.full_name || profile.email}
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, padding: '8px 0', overflowY: 'auto' }}>
        {visibleApps.map((app) => {
          const isActive = location.pathname === app.path;
          return (
            <Link
              key={app.path}
              to={app.path}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 16px',
                textDecoration: 'none',
                borderRadius: 0,
                background: isActive ? 'var(--anka-accent-muted)' : 'transparent',
                borderLeft: isActive ? '2px solid var(--anka-accent)' : '2px solid transparent',
                color: isActive ? 'var(--anka-accent)' : 'var(--anka-text-secondary)',
                fontSize: 13,
                fontWeight: isActive ? 500 : 400,
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = 'var(--anka-bg-hover)';
                  e.currentTarget.style.color = 'var(--anka-text-primary)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isActive) {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.color = 'var(--anka-text-secondary)';
                }
              }}
            >
              <span style={{ fontSize: 16 }}>{app.icon}</span>
              <span>{app.name}</span>
            </Link>
          );
        })}
      </nav>

      {/* Sign out */}
      <div style={{ padding: '12px 16px', borderTop: '1px solid var(--anka-border)' }}>
        <button
          onClick={signOut}
          style={{
            width: '100%',
            padding: '8px 12px',
            background: 'transparent',
            border: '1px solid var(--anka-border)',
            borderRadius: 8,
            color: 'var(--anka-text-secondary)',
            fontSize: 12,
            cursor: 'pointer',
            textAlign: 'center',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--anka-bg-hover)';
            e.currentTarget.style.color = 'var(--anka-text-primary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.color = 'var(--anka-text-secondary)';
          }}
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
