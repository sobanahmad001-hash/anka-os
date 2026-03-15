import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function Kanban() {
  const [tasks, setTasks] = useState({ todo: [], in_progress: [], done: [] })
  const [loading, setLoading] = useState(true)
  const { profile } = useAuth()

  useEffect(() => {
    fetchTasks()
  }, [])

  async function fetchTasks() {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Error fetching tasks:', error)
    } else {
      const grouped = {
        todo: data.filter(t => t.status === 'todo'),
        in_progress: data.filter(t => t.status === 'in_progress'),
        done: data.filter(t => t.status === 'done')
      }
      setTasks(grouped)
    }
    setLoading(false)
  }

  async function updateTaskStatus(taskId, newStatus) {
    const { error } = await supabase
      .from('tasks')
      .update({ status: newStatus })
      .eq('id', taskId)

    if (!error) fetchTasks()
  }

  if (loading) return <div className="p-6">Loading tasks...</div>

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">📋 Kanban Board</h1>
        <button className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
          + New Task
        </button>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {['todo', 'in_progress', 'done'].map(status => (
          <div key={status} className="bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
            <h2 className="font-bold mb-4 capitalize">{status.replace('_', ' ')} ({tasks[status].length})</h2>
            <div className="space-y-3">
              {tasks[status].map(task => (
                <div
                  key={task.id}
                  className="bg-white dark:bg-gray-700 p-4 rounded shadow cursor-pointer hover:shadow-lg transition"
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('taskId', task.id)}
                  onDrop={(e) => {
                    e.preventDefault()
                    const draggedTaskId = e.dataTransfer.getData('taskId')
                    updateTaskStatus(draggedTaskId, status)
                  }}
                  onDragOver={(e) => e.preventDefault()}
                >
                  <h3 className="font-semibold mb-2">{task.title}</h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">{task.description}</p>
                  <div className="mt-2 flex gap-2">
                    <span className={`text-xs px-2 py-1 rounded ${
                      task.priority === 5 ? 'bg-red-100 text-red-800' :
                      task.priority >= 3 ? 'bg-yellow-100 text-yellow-800' :
                      'bg-green-100 text-green-800'
                    }`}>
                      P{task.priority}
                    </span>
                    {task.due_date && (
                      <span className="text-xs text-gray-500">
                        📅 {new Date(task.due_date).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
