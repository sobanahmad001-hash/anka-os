export default function StatCard({
  label,
  value,
  change,
  trend,
  icon,
  color = 'blue'
}) {
  const colors = {
    blue: 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 shadow-sm',
    green: 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 shadow-sm',
    red: 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 shadow-sm',
    yellow: 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 shadow-sm',
    purple: 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 shadow-sm',
  }

  return (
    <div className={`rounded-2xl p-5 ${colors[color]}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</span>
        {icon && <span className="text-xl">{icon}</span>}
      </div>

      <div className="flex items-baseline gap-3">
        <span className="text-3xl font-bold tracking-tight">{value}</span>

        {change && (
          <span
            className={`text-sm font-medium ${
              trend === 'up'
                ? 'text-blue-600 dark:text-blue-300'
                : trend === 'down'
                ? 'text-amber-600 dark:text-amber-300'
                : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            {trend === 'up' ? '↑' : trend === 'down' ? '↓' : '→'} {change}
          </span>
        )}
      </div>
    </div>
  )
}
