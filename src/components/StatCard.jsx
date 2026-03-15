export default function StatCard({ 
  label, 
  value, 
  change, 
  trend, 
  icon,
  color = 'blue' 
}) {
  const colors = {
    blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
    green: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400',
    red: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400',
    yellow: 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400',
    purple: 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
  }
  
  return (
    <div className={`rounded-xl p-6 ${colors[color]}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium opacity-80">{label}</span>
        {icon && <span className="text-2xl">{icon}</span>}
      </div>
      
      <div className="flex items-baseline gap-3">
        <span className="text-3xl font-bold">{value}</span>
        
        {change && (
          <span className={`text-sm font-medium ${
            trend === 'up' ? 'text-green-600' : 
            trend === 'down' ? 'text-red-600' : 
            'text-gray-600'
          }`}>
            {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'} {change}
          </span>
        )}
      </div>
    </div>
  )
}
