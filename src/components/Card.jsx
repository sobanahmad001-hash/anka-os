export default function Card({
  title,
  subtitle,
  children,
  action,
  variant = 'default',
  className = ''
}) {
  const variants = {
    default: 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-sm',
    primary: 'bg-blue-50 dark:bg-blue-950/30 border-blue-100 dark:border-blue-900/40 shadow-sm',
    success: 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-100 dark:border-emerald-900/40 shadow-sm',
    warning: 'bg-amber-50 dark:bg-amber-950/20 border-amber-100 dark:border-amber-900/40 shadow-sm',
    danger: 'bg-red-50 dark:bg-red-950/20 border-red-100 dark:border-red-900/40 shadow-sm',
  }

  return (
    <div className={`rounded-2xl border p-6 ${variants[variant]} ${className}`}>
      {(title || action) && (
        <div className="flex items-start justify-between gap-4 mb-5">
          <div className="min-w-0">
            {title && (
              <h3 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="text-sm leading-6 text-slate-500 dark:text-slate-400 mt-1">
                {subtitle}
              </p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </div>
  )
}
