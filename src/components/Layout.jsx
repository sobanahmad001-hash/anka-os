import { Outlet } from 'react-router-dom'
import Header from './Header'
import Sidebar from './Sidebar'
import AssistantFloat from './AssistantFloat'
import OrganizationGate from './OrganizationGate'

export default function Layout() {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#090b11] text-white">
      <Header />
      <OrganizationGate>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <Sidebar />
          <main className="anka-workspace relative min-h-0 min-w-0 flex-1 overflow-hidden">
            <Outlet />
          </main>
        </div>
        <AssistantFloat />
      </OrganizationGate>
    </div>
  )
}
