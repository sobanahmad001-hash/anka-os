import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

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
    { name: 'Admin', path: '/admin', icon: '⚙️', roles: ['admin'] },
  { name: 'Settings', path: '/settings', icon: '⚙️', roles: ['all'] },
]

export default function Sidebar() {
  const location = useLocation()
  const { profile } = useAuth()
  
  const visibleApps = CORE_APPS.filter(app => 
    app.roles.includes('all') || app.roles.includes(profile?.role)
  )
  
  return (
    <aside className="w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700">
      <div className="p-4 border-b border-gray-200 dark:border-gray-700">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Anka OS</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {profile?.department || 'Team'} Workspace
        </p>
      </div>
      
      <nav className="mt-4">
        {visibleApps.map(app => (
          <Link
            key={app.path}
            to={app.path}
            className={`flex items-center gap-3 px-4 py-3 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
              location.pathname === app.path 
                ? 'bg-gray-100 dark:bg-gray-700 border-l-4 border-blue-500' 
                : ''
            }`}
          >
            <span className="text-2xl">{app.icon}</span>
            <span className="font-medium">{app.name}</span>
          </Link>
        ))}
      </nav>
    </aside>
  )
}
