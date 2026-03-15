import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import AIPanel from './AIPanel'

export default function Layout() {
  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-900">
      {/* Sidebar Navigation */}
      <Sidebar />
      
      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto p-6">
        <Outlet />
      </main>
      
      {/* AI Panel */}
      <div className="w-80 border-l border-gray-200 dark:border-gray-700 flex flex-col">
        <AIPanel />
      </div>
    </div>
  )
}
