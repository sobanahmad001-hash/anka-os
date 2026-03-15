import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

export default function DevDashboard() {
  const [sprintData, setSprintData] = useState([])
  const [loading, setLoading] = useState(true)
  const { profile } = useAuth()
  
  useEffect(() => {
    fetchSprintData()
  }, [])
  
  async function fetchSprintData() {
    setLoading(true)
    const { data, error } = await supabase
      .from('sprints')
      .select('*')
      .eq('department_id', 'dev') // Assuming all sprints are tied to the dev department
      .order('start_date', { ascending: false })
    
    if (error) {
      console.error('Error fetching sprints:', error)
    } else {
      setSprintData(data)
    }
    setLoading(false)
  }
  
  if (loading) return <div>Loading sprint data...</div>
  
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Development Dashboard</h1>
      <div className="grid grid-cols-3 gap-6">
        {sprintData.map(sprint => (
          <div key={sprint.id} className="p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
            <h3 className="font-bold">{sprint.name}</h3>
            <p>Status: {sprint.status}</p>
            <p>Goal: {sprint.goal}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
