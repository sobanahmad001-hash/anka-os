import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function AdminDashboard() {
  const [timeRange, setTimeRange] = useState('today')
  const [metrics, setMetrics] = useState(null)
  const [loading, setLoading] = useState(true)
  const { profile } = useAuth()
  
  useEffect(() => {
    if (profile?.role !== 'admin') {
      // Redirect non-admins
      window.location.href = '/dashboard'
      return
    }
    fetchMetrics()
  }, [timeRange, profile])
  
  async function fetchMetrics() {
    setLoading(true)
    
    try {
      const dateFilter = getDateFilter(timeRange)
      
      // Fetch aggregated data from all departments with error handling
      const results = await Promise.allSettled([
        supabase
          .from('department_metrics')
          .select('*')
          .gte('date', dateFilter)
          .order('date', { ascending: false }),
        
        supabase
          .from('system_health_logs')
          .select('*')
          .order('recorded_at', { ascending: false })
          .limit(10),
        
        supabase
          .from('user_activity_logs')
          .select('*, profiles(full_name, department)')
          .order('created_at', { ascending: false })
          .limit(20),
        
        supabase
          .from('profiles')
          .select('id, department, role', { count: 'exact' }),
        
        supabase
          .from('tasks')
          .select('status, created_at, completed_at')
          .gte('created_at', dateFilter),
        
        supabase
          .from('deployments')
          .select('*')
          .gte('deployed_at', dateFilter)
      ])
      
      // Extract values or use empty arrays on failure
      const [departmentMetrics, systemHealth, recentActivity, userCount, taskStats, deploymentStats] = results.map((r, i) => {
        if (r.status === 'rejected') {
          console.warn(`Query ${i} failed:`, r.reason);
          return { data: [], count: 0 };
        }
        if (r.value?.error) {
          console.warn(`Query ${i} error:`, r.value.error);
          return { data: [], count: 0 };
        }
        return r.value;
      })
      
      // Calculate department comparison
      const deptComparison = calculateDepartmentComparison(departmentMetrics.data)
      
      setMetrics({
        departments: deptComparison,
        systemHealth: systemHealth.data || [],
        recentActivity: recentActivity.data || [],
        totalUsers: userCount.count || 0,
        usersByDept: groupBy(userCount.data, 'department'),
        taskStats: calculateTaskStats(taskStats.data || []),
        deploymentCount: deploymentStats.data?.length || 0
      })
    } catch (error) {
      console.error('Failed to fetch metrics:', error)
      // Set default metrics on error
      setMetrics({
        departments: [],
        systemHealth: [],
        recentActivity: [],
        totalUsers: 0,
        usersByDept: {},
        taskStats: { total: 0, completed: 0, inProgress: 0, avgCompletionTime: 0 },
        deploymentCount: 0
      })
    } finally {
      setLoading(false)
    }
  }
  
  function getDateFilter(range) {
    const now = new Date()
    switch(range) {
      case 'today':
        return new Date(now.setHours(0,0,0,0)).toISOString()
      case 'week':
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        return weekAgo.toISOString()
      case 'month':
        const monthAgo = new Date(now.setMonth(now.getMonth() - 1))
        return monthAgo.toISOString()
      case 'quarter':
        const quarterAgo = new Date(now.setMonth(now.getMonth() - 3))
        return quarterAgo.toISOString()
      default:
        return new Date(now.setHours(0,0,0,0)).toISOString()
    }
  }
  
  function calculateDepartmentComparison(data) {
    const byDept = groupBy(data, 'department_id')
    return Object.entries(byDept).map(([dept, metrics]) => ({
      department: dept,
      totalTasks: metrics.reduce((sum, m) => sum + (m.tasks_completed || 0), 0),
      velocity: metrics.reduce((sum, m) => sum + (m.velocity || 0), 0),
      activeUsers: metrics[0]?.active_users || 0,
      blockers: metrics.reduce((sum, m) => sum + (m.blockers_count || 0), 0)
    }))
  }
  
  function calculateTaskStats(tasks) {
    const total = tasks.length
    const completed = tasks.filter(t => t.status === 'done').length
    const inProgress = tasks.filter(t => t.status === 'in_progress').length
    const avgCompletionTime = tasks
      .filter(t => t.completed_at)
      .reduce((sum, t) => {
        const hours = (new Date(t.completed_at) - new Date(t.created_at)) / (1000 * 60 * 60)
        return sum + hours
      }, 0) / (completed || 1)
    
    return { total, completed, inProgress, avgCompletionTime: Math.round(avgCompletionTime) }
  }
  
  function groupBy(array, key) {
    return (array || []).reduce((result, item) => {
      const group = item[key] || 'unknown'
      result[group] = result[group] || []
      result[group].push(item)
      return result
    }, {})
  }
  
  async function exportData() {
    // TODO: Implement CSV export
    alert('Export functionality coming soon')
  }
  
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading admin dashboard...</p>
        </div>
      </div>
    )
  }

  if (!metrics) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <p className="text-gray-600 dark:text-gray-400">Failed to load metrics. Please refresh.</p>
        </div>
      </div>
    )
  }
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Admin Dashboard</h1>
          <p className="text-gray-600 dark:text-gray-400">System-wide metrics and monitoring</p>
        </div>
        
        <div className="flex gap-3">
          {/* Time Range Selector */}
          <div className="flex gap-2 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
            {['today', 'week', 'month', 'quarter'].map(range => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-4 py-2 rounded-md font-medium capitalize transition-colors ${
                  timeRange === range
                    ? 'bg-white dark:bg-gray-700 text-blue-600 shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
              >
                {range}
              </button>
            ))}
          </div>
          
          <button
            onClick={exportData}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
          >
            📊 Export Data
          </button>
        </div>
      </div>
      
      {/* Key Metrics Row */}
      <div className="grid grid-cols-4 gap-6">
        <MetricCard
          title="Total Users"
          value={metrics.totalUsers}
          change="+12%"
          trend="up"
          icon="👥"
        />
        <MetricCard
          title="Tasks Completed"
          value={metrics.taskStats.completed}
          subtitle={`${metrics.taskStats.total} total`}
          trend="up"
          icon="✓"
        />
        <MetricCard
          title="Deployments"
          value={metrics.deploymentCount}
          subtitle="This period"
          trend="neutral"
          icon="🚀"
        />
        <MetricCard
          title="Avg Completion Time"
          value={`${metrics.taskStats.avgCompletionTime}h`}
          trend="down"
          icon="⏱️"
        />
      </div>
      
      {/* Department Comparison */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <h2 className="text-xl font-bold mb-6">Department Performance</h2>
        <div className="space-y-4">
          {metrics.departments && metrics.departments.length > 0 ? (
            metrics.departments.map(dept => (
              <DepartmentRow key={dept.department} data={dept} />
            ))
          ) : (
            <p className="text-gray-500 dark:text-gray-400">No department data available</p>
          )}
        </div>
      </div>
      
      {/* Two Column Layout */}
      <div className="grid grid-cols-2 gap-6">
        {/* System Health */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-xl font-bold mb-4">System Health</h2>
          <div className="space-y-3">
            {metrics.systemHealth && metrics.systemHealth.length > 0 ? (
              metrics.systemHealth.slice(0, 5).map(log => (
                <div key={log.id} className="flex items-center justify-between py-2">
                  <div>
                    <p className="font-medium text-sm">{log.metric_type}</p>
                    <p className="text-xs text-gray-500">{new Date(log.recorded_at).toLocaleString()}</p>
                  </div>
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                  log.status === 'healthy' 
                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                    : log.status === 'warning'
                    ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
                    : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                }`}>
                  {log.status}
                </span>
              </div>
              ))
            ) : (
              <p className="text-gray-500 dark:text-gray-400">No system health data available</p>
            )}
          </div>
        </div>
        
        {/* Recent Activity */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-xl font-bold mb-4">Recent Activity</h2>
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {metrics.recentActivity && metrics.recentActivity.length > 0 ? (
              metrics.recentActivity.map(activity => (
                <div key={activity.id} className="flex items-start gap-3 py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
                  <div className="flex-1">
                    <p className="text-sm font-medium">
                      {activity.profiles?.full_name} 
                      <span className="text-gray-500 font-normal"> {activity.action}</span>
                    </p>
                    <p className="text-xs text-gray-500">
                      {activity.profiles?.department} • {new Date(activity.created_at).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-gray-500 dark:text-gray-400">No activity data available</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function MetricCard({ title, value, subtitle, change, trend, icon }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-center justify-between mb-2">
        <p className="text-sm text-gray-600 dark:text-gray-400">{title}</p>
        <span className="text-2xl">{icon}</span>
      </div>
      <p className="text-3xl font-bold text-gray-900 dark:text-white mb-1">{value}</p>
      {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
      {change && (
        <p className={`text-sm font-medium ${
          trend === 'up' ? 'text-green-600' : trend === 'down' ? 'text-red-600' : 'text-gray-600'
        }`}>
          {change}
        </p>
      )}
    </div>
  )
}

function DepartmentRow({ data }) {
  return (
    <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
      <div className="flex items-center gap-4 flex-1">
        <div className="w-32">
          <p className="font-bold text-gray-900 dark:text-white capitalize">{data.department}</p>
        </div>
        <div className="flex gap-8">
          <div>
            <p className="text-xs text-gray-500">Tasks</p>
            <p className="font-bold">{data.totalTasks}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Velocity</p>
            <p className="font-bold">{data.velocity}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Active Users</p>
            <p className="font-bold">{data.activeUsers}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Blockers</p>
            <p className="font-bold text-red-600">{data.blockers}</p>
          </div>
        </div>
      </div>
      <div className="w-64 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
        <div 
          className="bg-blue-600 h-2 rounded-full" 
          style={{ width: `${Math.min((data.totalTasks / 50) * 100, 100)}%` }}
        ></div>
      </div>
    </div>
  )
}
