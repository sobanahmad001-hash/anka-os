import { Outlet, useLocation } from 'react-router-dom'
import Header from './Header'
import Sidebar from './Sidebar'
import AIPanel from './AIPanel'
import { getEnvironmentFromPath } from '../config/environmentNav'

export default function Layout() {
  const location = useLocation()
  const activeEnvKey = getEnvironmentFromPath(location.pathname)
  const showDevAssistant = activeEnvKey === 'development'

  return (
    <div className="h-screen overflow-hidden bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <div className="h-full flex flex-col">
        <Header />

        <div className="flex-1 min-h-0 flex">
          <Sidebar />

          <main className="flex-1 min-w-0 min-h-0 overflow-y-auto">
            <div className="px-6 py-6 lg:px-8 lg:py-8 max-w-[1680px] mx-auto">
              <Outlet />
            </div>
          </main>

          {showDevAssistant && (
            <aside className="hidden xl:flex xl:w-[390px] shrink-0 border-l border-slate-200 dark:border-slate-800 bg-white/70 dark:bg-slate-950/80 backdrop-blur-sm min-h-0">
              <div className="h-full w-full p-4">
                <AIPanel
                  title="Anka AI"
                  subtitle="Persistent development copilot for blockers, tasks, docs, and execution support."
                  placeholder="Ask Anka AI to create tasks, summarize blockers, or guide the dev workflow..."
                />
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  )
}
