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
    <aside className="w-72 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/90 backdrop-blur-sm min-h-0 overflow-y-auto">
      <div className="p-5 border-b border-slate-200 dark:border-slate-800">
        <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
          Current Environment
        </div>
        <div className="mt-2 text-xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          {activeEnv.label}
        </div>
        <div className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
          {activeEnv.description}
        </div>
      </div>

      <div className="p-4">
        <div className="mb-3 px-2 text-[11px] uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
          Views
        </div>

        <div className="space-y-1.5">
          {visibleItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `group block rounded-xl px-3.5 py-3 text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200 shadow-sm border border-blue-100 dark:border-blue-900/40'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100'
                }`
              }
            >
              <div className="flex items-center justify-between gap-3">
                <span>{item.label}</span>
              </div>
            </NavLink>
          ))}
        </div>
      </div>
    </aside>
  )
}
