import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Sidebar() {
  const { profile } = useAuth()

  const coreApps = [
    { name: 'Dashboard', path: '/', icon: '📊' },
    { name: 'Dev Dashboard', path: '/dev-dashboard', icon: '💻' },
  ]

  const devApps = [
    { name: 'Kanban', path: '/kanban', icon: '📋' },
    { name: 'Projects', path: '/projects', icon: '📁' },
    { name: 'Tasks', path: '/tasks', icon: '✅' },
    { name: 'Git', path: '/git', icon: '🌐' },
    { name: 'Terminal', path: '/terminal', icon: '🖥️' },
    { name: 'API Docs', path: '/api-docs', icon: '📖' },
    { name: 'Files', path: '/files', icon: '📂' },
  ]

  const adminApps = profile?.role === 'admin' ? [
    { name: 'Admin', path: '/admin', icon: '⚙️' },
    { name: 'Users', path: '/users', icon: '👥' },
  ] : []

  return (
    <div className="w-64 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 overflow-y-auto">
      <div className="p-4">
        <h2 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase mb-2">Core</h2>
        {coreApps.map(app => (
          <NavLink
            key={app.path}
            to={app.path}
            end={app.path === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded mb-1 ${
                isActive
                  ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                  : 'text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`
            }
          >
            <span>{app.icon}</span>
            <span>{app.name}</span>
          </NavLink>
        ))}

        <h2 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase mb-2 mt-6">Dev Module</h2>
        {devApps.map(app => (
          <NavLink
            key={app.path}
            to={app.path}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded mb-1 ${
                isActive
                  ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                  : 'text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`
            }
          >
            <span>{app.icon}</span>
            <span>{app.name}</span>
          </NavLink>
        ))}

        {adminApps.length > 0 && (
          <>
            <h2 className="text-xs font-bold text-gray-700 dark:text-gray-300 uppercase mb-2 mt-6">Admin</h2>
            {adminApps.map(app => (
              <NavLink
                key={app.path}
                to={app.path}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2 rounded mb-1 ${
                    isActive
                      ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                      : 'text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`
                }
              >
                <span>{app.icon}</span>
                <span>{app.name}</span>
              </NavLink>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
