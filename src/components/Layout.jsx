import { Outlet } from 'react-router-dom'
import Header from './Header'
import Sidebar from './Sidebar'

export default function Layout() {
  return (
    <div className="min-h-screen bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <Header />
      <div className="flex">
        <Sidebar />
        <main className="flex-1 min-w-0 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
