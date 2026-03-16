import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { environmentNav, getEnvironmentFromPath } from '../config/environmentNav'

export default function Sidebar() {
  const { profile } = useAuth()
  const location = useLocation()
  const activeEnvKey = getEnvironmentFromPath(location.pathname)
  const activeEnv = environmentNav.find((env) => env.key === activeEnvKey) || environmentNav[1]

  const visibleItems = activeEnv.items.filter((item) => {
    if (activeEnv.key === 'admin' && profile?.role !== 'admin') return false
    return true
  })

  return (
    <aside className="w-72 shrink-0 border-r border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 min-h-[calc(100vh-73px)]">
      <div className="p-4 border-b border-gray-200 dark:border-gray-800">
        <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Current Environment
        </div>
        <div className="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
          {activeEnv.label}
        </div>
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {activeEnv.description}
        </div>
      </div>

      <div className="p-3">
        <div className="mb-2 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Views
        </div>

        <div className="space-y-1">
          {visibleItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `block px-3 py-2 rounded text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                    : 'text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      </div>
    </aside>
  )
}
