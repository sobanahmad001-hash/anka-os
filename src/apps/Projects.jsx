import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function Projects() {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const { profile } = useAuth()
  
  useEffect(() => {
    fetchProjects()
  }, [])
  
  async function fetchProjects() {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .eq('department_id', profile?.department)
      .order('created_at', { ascending: false })
    
    if (error) {
      console.error('Error fetching projects:', error)
    } else {
      setProjects(data)
    }
    setLoading(false)
  }
  
  if (loading) return <div className="flex items-center justify-center h-64">Loading projects...</div>
  
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Projects</h1>
        <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
          New Project
        </button>
      </div>
      
      <div className="grid gap-4">
        {projects.length === 0 ? (
          <p className="text-gray-500">No projects yet. Create one to get started.</p>
        ) : (
          projects.map(project => (
            <div key={project.id} className="p-6 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-lg font-bold text-gray-900 dark:text-white">{project.name}</h3>
                <span className={`px-3 py-1 text-xs font-medium rounded-full ${
                  project.status === 'active' 
                    ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                    : project.status === 'completed'
                    ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200'
                    : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                }`}>
                  {project.status}
                </span>
              </div>
              
              <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">{project.description}</p>
              
              <div className="flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
                <span>Priority: {project.priority || 'Normal'}</span>
                <span>•</span>
                <span>Progress: {project.progress || 0}%</span>
                {project.due_date && (
                  <>
                    <span>•</span>
                    <span>Due: {new Date(project.due_date).toLocaleDateString()}</span>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
