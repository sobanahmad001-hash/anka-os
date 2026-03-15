import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useRealtimeSubscription } from '../hooks/useRealtimeSubscription'
import { useAuth } from '../context/AuthContext'

export default function Tasks() {
  const [tasks, setTasks] = useState([])
  const [view, setView] = useState('list')
  const [loading, setLoading] = useState(true)
  const { profile } = useAuth()
  
  useEffect(() => {
    fetchTasks()
  }, [])
  
  // Real-time subscription for task updates
  useRealtimeSubscription('tasks', (payload) => {
    console.log('📡 Task update:', payload)
    fetchTasks() // Refresh task list
  })
  
  async function fetchTasks() {
    const { data, error } = await supabase
      .from('tasks')
      .select('*, projects(name)')
      .eq('assigned_to', profile?.id)
      .order('created_at', { ascending: false })
    
    if (error) {
      console.error('Error fetching tasks:', error)
    } else {
      setTasks(data)
    }
    setLoading(false)
  }
  
  if (loading) return <div className="flex items-center justify-center h-64">Loading tasks...</div>
  
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">My Tasks</h1>
        
        <div className="flex gap-2">
          <button
            onClick={() => setView('list')}
            className={`px-4 py-2 rounded-lg font-medium ${
              view === 'list' 
                ? 'bg-blue-600 text-white' 
                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
            }`}
          >
            List
          </button>
          <button
            onClick={() => setView('kanban')}
            className={`px-4 py-2 rounded-lg font-medium ${
              view === 'kanban' 
                ? 'bg-blue-600 text-white' 
                : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'
            }`}
          >
            Kanban
          </button>
        </div>
      </div>
      
      {view === 'list' ? (
        <div className="space-y-3">
          {tasks.map(task => (
            <div key={task.id} className="p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
              <div className="flex items-start justify-between mb-2">
                <h3 className="font-bold text-gray-900 dark:text-white">{task.title}</h3>
                <span className={`px-2 py-1 text-xs rounded ${
                  task.status === 'done' 
                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                    : task.status === 'in_progress'
                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                    : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                }`}>
                  {task.status}
                </span>
              </div>
              
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                {task.projects?.name || 'No project'}
              </p>
              
              <div className="flex items-center gap-3 text-sm text-gray-500">
                <span>Priority: {task.priority || 'N/A'}</span>
                {task.due_date && (
                  <>
                    <span>•</span>
                    <span>Due: {new Date(task.due_date).toLocaleDateString()}</span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg">
            <h3 className="font-bold mb-4 text-gray-900 dark:text-white">To Do</h3>
            {tasks.filter(t => t.status === 'todo').map(task => (
              <div key={task.id} className="p-3 bg-white dark:bg-gray-700 rounded mb-3">
                <p className="font-medium text-sm">{task.title}</p>
              </div>
            ))}
          </div>
          
          <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg">
            <h3 className="font-bold mb-4 text-gray-900 dark:text-white">In Progress</h3>
            {tasks.filter(t => t.status === 'in_progress').map(task => (
              <div key={task.id} className="p-3 bg-white dark:bg-gray-700 rounded mb-3">
                <p className="font-medium text-sm">{task.title}</p>
              </div>
            ))}
          </div>
          
          <div className="bg-gray-100 dark:bg-gray-800 p-4 rounded-lg">
            <h3 className="font-bold mb-4 text-gray-900 dark:text-white">Done</h3>
            {tasks.filter(t => t.status === 'done').map(task => (
              <div key={task.id} className="p-3 bg-white dark:bg-gray-700 rounded mb-3">
                <p className="font-medium text-sm">{task.title}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
