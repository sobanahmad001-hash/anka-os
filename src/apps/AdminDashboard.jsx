import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Card from '../components/Card'
import StatCard from '../components/StatCard'
import Badge from '../components/Badge'
import EmptyState from '../components/EmptyState'
import LoadingSkeleton from '../components/LoadingSkeleton'

export default function AdminDashboard() {
  const [timeRange, setTimeRange] = useState('today')
  const [metrics, setMetrics] = useState(null)
  const [loading, setLoading] = useState(true)
  const { profile } = useAuth()
  
  useEffect(() => {
    if (profile?.role !== 'admin') {
      window.location.href = '/dashboard'
      return
    }
    fetchMetrics()
  }, [timeRange, profile])
  
  async function fetchMetrics() {
    setLoading(true)
    const dateFilter = getDateFilter(timeRange)
    
    const [
      departmentMetrics,
      systemHealth,
      recentActivity,
      userCount,
      taskStats,
      deploymentStats
    ] = await Promise.all([
      supabase.from('department_metrics').select('*').gte('date', dateFilter).order('date', { ascending: false }),
      supabase.from('system_health_logs').select('*').order('recorded_at', { ascending: false }).limit(10),
      supabase.from('user_activity_logs').select('*, profiles(full_name, department)').order('created_at', { ascending: false }).limit(20),
      supabase.from('profiles').select('id, department, role', { count: 'exact' }),
      supabase.from('tasks').select('status, created_at, completed_at').gte('created_at', dateFilter),
      supabase.from('deployments').select('*').gte('deployed_at', dateFilter)
    ])
    
    const deptComparison = calculateDepartmentComparison(departmentMetrics.data)
    
    setMetrics({
      departments: deptComparison,
      systemHealth: systemHealth.data,
      recentActivity: recentActivity.data,
      totalUsers: userCount.count,
      usersByDept: groupBy(userCount.data, 'department'),
      taskStats: calculateTaskStats(taskStats.data),
      deploymentCount: deploymentStats.data?.length || 0
    })
    
    setLoading(false)
  }
  
  function getDateFilter(range) {
    const now = new Date()
    switch(range) {
      case 'today': return new Date(now.setHours(0,0,0,0)).toISOString()
      case 'week': return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
      case 'month': return new Date(now.setMonth(now.getMonth() - 1)).toISOString()
      case 'quarter': return new Date(now.setMonth(now.getMonth() - 3)).toISOString()
      default: return new Date(now.setHours(0,0,0,0)).toISOString()
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
    const avgCompletionTime = tasks.filter(t => t.completed_at).reduce((sum, t) => {
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
  
  if (loading) {
    return (
      <div className="space-y-6">
        <LoadingSkeleton type="card" count={4} />
      </div>
    )
  }
  
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Admin Dashboard</h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">System-wide metrics and monitoring</p>
        </div>
        
        <div className="flex gap-3">
          {/* Time Range Selector */}
          <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
            {['today', 'week', 'month', 'quarter'].map(range => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-4 py-2 rounded-md font-medium capitalize transition-all ${
                  timeRange === range
                    ? 'bg-white dark:bg-gray-700 text-blue-600 shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                }`}
              >
                {range}
              </button>
            ))}
          </div>
          
          <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors">
            📊 Export
          </button>
        </div>
      </div>
      
      {/* Stat Cards */}
      <div className="grid grid-cols-4 gap-6">
        <StatCard
          label="Total Users"
          value={metrics.totalUsers}
          change="+12%"
          trend="up"
          icon="👥"
          color="blue"
        />
        <StatCard
          label="Tasks Completed"
          value={metrics.taskStats.completed}
          change={`${metrics.taskStats.total} total`}
          trend="up"
          icon="✓"
          color="green"
        />
        <StatCard
          label="Deployments"
          value={metrics.deploymentCount}
          icon="🚀"
          color="purple"
        />
        <StatCard
          label="Avg Time"
          value={`${metrics.taskStats.avgCompletionTime}h`}
          trend="down"
          icon="⏱️"
          color="yellow"
        />
      </div>
      
      {/* Department Performance */}
      <Card title="Department Performance" subtitle="Compare team productivity">
        {metrics.departments.length === 0 ? (
          <EmptyState
            icon="📊"
            title="No department data"
            description="Department metrics will appear here once teams start working"
          />
        ) : (
          <div className="space-y-4">
            {metrics.departments.map(dept => (
              <div key={dept.department} className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                <div className="flex items-center gap-4 flex-1">
                  <div className="w-32">
                    <p className="font-bold text-gray-900 dark:text-white capitalize">{dept.department}</p>
                  </div>
                  <div className="flex gap-8">
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Tasks</p>
                      <p className="font-bold">{dept.totalTasks}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Velocity</p>
                      <p className="font-bold">{dept.velocity}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Active Users</p>
                      <p className="font-bold">{dept.activeUsers}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Blockers</p>
                      <Badge variant="danger">{dept.blockers}</Badge>
                    </div>
                  </div>
                </div>
                <div className="w-64 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                  <div 
                    className="bg-blue-600 h-2 rounded-full" 
                    style={{ width: `${Math.min((dept.totalTasks / 50) * 100, 100)}%` }}
                  ></div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      
      {/* System Health & Activity */}
      <div className="grid grid-cols-2 gap-6">
        <Card title="System Health">
          <div className="space-y-3">
            {metrics.systemHealth.slice(0, 5).map(log => (
              <div key={log.id} className="flex items-center justify-between py-2">
                <div>
                  <p className="font-medium text-sm">{log.metric_type}</p>
                  <p className="text-xs text-gray-500">{new Date(log.recorded_at).toLocaleString()}</p>
                </div>
                <Badge variant={
                  log.status === 'healthy' ? 'success' :
                  log.status === 'warning' ? 'warning' : 'danger'
                }>
                  {log.status}
                </Badge>
              </div>
            ))}
          </div>
        </Card>
        
        <Card title="Recent Activity">
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {metrics.recentActivity.map(activity => (
              <div key={activity.id} className="flex items-start gap-3 py-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
                <div className="flex-1">
                  <p className="text-sm font-medium">
                    {activity.profiles?.full_name} 
                    <span className="text-gray-500 font-normal"> {activity.action}</span>
                  </p>
                  <p className="text-xs text-gray-500">
                    <Badge variant="default" size="sm">{activity.profiles?.department}</Badge>
                    {' • '}
                    {new Date(activity.created_at).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
