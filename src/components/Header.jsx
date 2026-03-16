import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { environmentNav, getEnvironmentFromPath } from '../config/environmentNav'

export default function Header() {
  const { profile, signOut } = useAuth()
  const location = useLocation()
  const activeEnvKey = getEnvironmentFromPath(location.pathname)

  return (
    <header className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <div className="px-4 py-3 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Anka OS
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Environment-first organizational operating system
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="text-sm text-gray-600 dark:text-gray-300 hidden md:block">
            {profile?.full_name || profile?.email}
          </div>
          <button
            onClick={signOut}
            className="px-3 py-2 rounded text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            Sign Out
          </button>
        </div>
      </div>

      <div className="px-4 pb-3">
        <nav className="flex flex-wrap gap-2">
          {environmentNav.map((env) => {
            const isLockedAdmin = env.key === 'admin' && profile?.role !== 'admin'

            if (isLockedAdmin) return null

            return (
              <NavLink
                key={env.key}
                to={env.basePath}
                className={() =>
                  `px-3 py-2 rounded text-sm font-medium transition-colors ${
                    activeEnvKey === env.key
                      ? 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`
                }
              >
                {env.label}
              </NavLink>
            )
          })}
        </nav>
      </div>
    </header>
  )
}
