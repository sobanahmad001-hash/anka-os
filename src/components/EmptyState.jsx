export default function EmptyState({ 
  icon = '📭', 
  title, 
  description, 
  action 
}) {
  return (
    <div className="text-center py-12">
      <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-800 mb-4">
        <span className="text-3xl">{icon}</span>
      </div>
      
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
        {title}
      </h3>
      
      {description && (
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-6 max-w-sm mx-auto">
          {description}
        </p>
      )}
      
      {action && (
        <div className="mt-6">
          {action}
        </div>
      )}
    </div>
  )
}
