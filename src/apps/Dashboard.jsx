export default function Dashboard() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">
        Dashboard
      </h1>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6">
          <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Active Tasks</div>
          <div className="text-3xl font-bold text-gray-900 dark:text-white mt-2">0</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6">
          <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Projects</div>
          <div className="text-3xl font-bold text-gray-900 dark:text-white mt-2">0</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6">
          <div className="text-sm font-medium text-gray-500 dark:text-gray-400">Team</div>
          <div className="text-3xl font-bold text-gray-900 dark:text-white mt-2">0</div>
        </div>
      </div>
    </div>
  )
}
