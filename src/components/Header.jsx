import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { environmentNav, getEnvironmentFromPath } from '../config/environmentNav'

export default function Header() {
  const { profile, signOut } = useAuth()
  const location = useLocation()
  const activeEnvKey = getEnvironmentFromPath(location.pathname)

  return (
    <header className="shrink-0 border-b border-slate-200 dark:border-slate-800 bg-white/90 dark:bg-slate-950/90 backdrop-blur-sm">
      <div className="px-5 py-4 lg:px-8 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Anka OS
          </div>
          <div className="text-xs tracking-wide text-slate-500 dark:text-slate-400 mt-1">
            Internal operating system for organized execution
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <div className="hidden md:block text-sm text-slate-500 dark:text-slate-400">
            {profile?.full_name || profile?.email}
          </div>
          <button
            onClick={signOut}
            className="rounded-xl px-3.5 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            Sign Out
          </button>
        </div>
      </div>

      <div className="px-5 pb-4 lg:px-8">
        <nav className="flex flex-wrap gap-2">
          {environmentNav.map((env) => {
            const isLockedAdmin = env.key === 'admin' && profile?.role !== 'admin'
            if (isLockedAdmin) return null

            return (
              <NavLink
                key={env.key}
                to={env.basePath}
                className={() =>
                  `rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
                    activeEnvKey === env.key
                      ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200 border border-blue-100 dark:border-blue-900/40'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'
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
