import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { environmentNav, getEnvironmentFromPath } from '../config/environmentNav'

export default function Sidebar() {
  const { profile } = useAuth()
  const location = useLocation()
  const activeEnvKey = getEnvironmentFromPath(location.pathname)
  const activeEnv = environmentNav.find(e => e.key === activeEnvKey) || environmentNav[2]
  const userDept = profile?.department

  function shouldShow(item) {
    if (activeEnv.key === 'admin') {
      return profile?.role === 'admin'
    }
    if (activeEnv.key === 'diversify') return true
    if (activeEnv.key === 'sphere') {
      if (item.dept === null) return true
      if (item.isHeader) {
        return profile?.role === 'admin' || userDept === item.dept
      }
      return profile?.role === 'admin' || userDept === item.dept
    }
    return true
  }

  const visibleItems = activeEnv.items.filter(shouldShow)

  const DEPT_BADGE_COLORS = {
    design: 'bg-pink-900/50 text-pink-300',
    development: 'bg-blue-900/50 text-blue-300',
    marketing: 'bg-green-900/50 text-green-300',
  }

  return (
    <aside className="w-64 shrink-0 border-r border-gray-800 bg-gray-900 min-h-0 overflow-y-auto flex flex-col">
      <div className="p-5 border-b border-gray-800">
        <div className="text-[11px] uppercase tracking-[0.18em] text-gray-500">
          Current Environment
        </div>
        <div className="mt-2 text-lg font-bold text-white">
          {activeEnv.label}
        </div>
        <div className="mt-1 text-xs text-gray-500">
          {activeEnv.description}
        </div>
        {activeEnv.key === 'sphere' && userDept && profile?.role !== 'admin' && (
          <div className="mt-3">
            <span className={`text-xs px-2 py-1 rounded-full font-medium capitalize ${DEPT_BADGE_COLORS[userDept] || 'bg-gray-700 text-gray-300'}`}>
              {userDept} dept
            </span>
          </div>
        )}
        {activeEnv.key === 'sphere' && profile?.role === 'admin' && (
          <div className="mt-3">
            <span className="text-xs px-2 py-1 rounded-full font-medium bg-purple-900/50 text-purple-300">
              admin · all depts
            </span>
          </div>
        )}
      </div>

      <div className="p-4 flex-1">
        <div className="mb-3 px-2 text-[11px] uppercase tracking-[0.18em] text-gray-500">
          Views
        </div>
        <div className="space-y-0.5">
          {visibleItems.map((item, i) => {
            if (item.isHeader) {
              return (
                <div key={i} className="px-2 pt-4 pb-1">
                  <p className="text-[10px] uppercase tracking-widest text-gray-600 font-semibold">
                    {item.label.replace('— ', '')}
                  </p>
                </div>
              )
            }

            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `block rounded-xl px-3.5 py-2.5 text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-purple-600 text-white shadow-sm'
                      : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                  }`
                }
              >
                {item.label}
              </NavLink>
            )
          })}
        </div>
      </div>
    </aside>
  )
}
