import { Outlet, useLocation } from 'react-router-dom'
import Header from './Header'
import Sidebar from './Sidebar'
import { getEnvironmentFromPath } from '../config/environmentNav'
import AssistantFloat from './AssistantFloat'

export default function Layout() {
  const location = useLocation()
  const activeEnvKey = getEnvironmentFromPath(location.pathname)

  return (
    <div className="h-screen overflow-hidden bg-gray-950 text-white flex flex-col">
      <Header />
      <div className="flex-1 min-h-0 flex overflow-hidden">
        <Sidebar />
        <main className="flex-1 min-w-0 min-h-0 overflow-hidden bg-gray-950">
          <Outlet />
        </main>
      </div>
      <AssistantFloat />
    </div>
  )
}
