import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { environmentNav, getEnvironmentFromPath } from '../config/environmentNav'
import { featureFlags } from '../config/featureFlags'

export default function Sidebar() {
  const { profile } = useAuth()
  const location = useLocation()
  const activeEnvKey = getEnvironmentFromPath(location.pathname)
  const activeEnv = environmentNav.find((environment) => environment.key === activeEnvKey)
    || environmentNav.find((environment) => environment.key === 'sphere')
  const userDept = profile?.department

  function shouldShow(item) {
    if (item.path === '/assistant' && !featureFlags.aiAssistance) return false
    if (activeEnv.key === 'admin') return profile?.role === 'admin'
    if (activeEnv.key === 'sphere') {
      if (item.dept === null) return true
      return profile?.role === 'admin' || userDept === item.dept
    }
    return false
  }

  const visibleItems = activeEnv.items.filter(shouldShow)
  const departmentBadgeColors = {
    content: 'bg-amber-900/50 text-amber-300',
    design: 'bg-pink-900/50 text-pink-300',
    development: 'bg-blue-900/50 text-blue-300',
    marketing: 'bg-green-900/50 text-green-300',
  }

  return (
    <aside className="hidden min-h-0 w-60 shrink-0 flex-col overflow-y-auto border-r border-white/[0.07] bg-[#0d1018]/95 md:flex">
      <div className="border-b border-white/[0.07] px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-violet-400/20 bg-violet-500/10 text-violet-300">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="8" />
              <path d="M8.5 9.5 12 7l3.5 2.5v5L12 17l-3.5-2.5z" />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-white">{activeEnv.label}</div>
            <div className="mt-0.5 text-[11px] text-slate-500">{activeEnv.description}</div>
          </div>
        </div>
        {activeEnv.key === 'sphere' && userDept && profile?.role !== 'admin' && (
          <div className="mt-4">
            <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${departmentBadgeColors[userDept] || 'bg-gray-700 text-gray-300'}`}>
              {userDept} department
            </span>
          </div>
        )}
        {activeEnv.key === 'sphere' && profile?.role === 'admin' && (
          <div className="mt-4">
            <span className="inline-flex rounded-full border border-violet-500/20 bg-violet-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-violet-300">
              All departments
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 p-3">
        <div className="mb-2 px-3 pt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600">
          Workspace
        </div>
        <div className="space-y-1">
          {visibleItems.map((item) => {
            if (item.isHeader) {
              return (
                <div key={`header-${item.label}`} className="px-3 pb-1 pt-5">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                    {item.label}
                  </p>
                </div>
              )
            }

            return (
              <NavLink
                key={item.path}
                to={item.path}
                className={({ isActive }) =>
                  `group flex items-center gap-3 rounded-xl border px-3 py-2.5 text-[13px] font-medium transition-all ${
                    isActive
                      ? 'border-violet-500/20 bg-violet-500/10 text-violet-100 shadow-[inset_3px_0_0_#8b5cf6]'
                      : 'border-transparent text-slate-400 hover:border-white/[0.06] hover:bg-white/[0.035] hover:text-white'
                  }`
                }
              >
                <NavIcon path={item.path} />
                <span className="truncate">{item.label}</span>
              </NavLink>
            )
          })}
        </div>
      </div>

      <div className="border-t border-white/[0.07] p-4">
        <p className="text-[11px] leading-5 text-slate-600">One system of record for delivery, review, and client visibility.</p>
      </div>
    </aside>
  )
}

function NavIcon({ path }) {
  const common = {
    width: 17,
    height: 17,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    className: 'shrink-0 text-slate-500 transition-colors group-hover:text-violet-300',
  }

  if (path?.includes('projects')) return <svg {...common}><rect x="4" y="4" width="6" height="6" rx="1.5"/><rect x="14" y="4" width="6" height="6" rx="1.5"/><rect x="4" y="14" width="6" height="6" rx="1.5"/><rect x="14" y="14" width="6" height="6" rx="1.5"/></svg>
  if (path?.includes('my-work')) return <svg {...common}><path d="m5 12 4 4L19 6"/><path d="M19 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h7"/></svg>
  if (path?.includes('clients')) return <svg {...common}><path d="M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 20v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
  if (path?.includes('portal')) return <svg {...common}><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v5"/></svg>
  if (path?.includes('reports')) return <svg {...common}><path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/></svg>
  if (path?.includes('assistant')) return <svg {...common}><path d="m12 3 1.4 3.6L17 8l-3.6 1.4L12 13l-1.4-3.6L7 8l3.6-1.4zM18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z"/></svg>
  if (path?.includes('settings')) return <svg {...common}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></svg>
  return <svg {...common}><path d="M4 7h16M4 12h16M4 17h10"/></svg>
}
