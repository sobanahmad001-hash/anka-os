import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function ApiDocs() {
  const [endpoints, setEndpoints] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchEndpoints()
  }, [])

  async function fetchEndpoints() {
    const { data, error } = await supabase
      .from('api_docs')
      .select('*')
      .order('category', { ascending: true })

    if (error) {
      console.error('Error fetching API docs:', error)
    } else {
      setEndpoints(data || [])
    }
    setLoading(false)
  }

  if (loading) return <div className="p-6">Loading API documentation...</div>

  const grouped = endpoints.reduce((acc, endpoint) => {
    if (!acc[endpoint.category]) acc[endpoint.category] = []
    acc[endpoint.category].push(endpoint)
    return acc
  }, {})

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">📖 API Documentation</h1>

      {Object.keys(grouped).length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          No API endpoints documented yet.
        </div>
      ) : (
        Object.entries(grouped).map(([category, items]) => (
          <div key={category} className="mb-8">
            <h2 className="text-xl font-bold mb-4 border-b pb-2">{category}</h2>
            <div className="space-y-4">
              {items.map(endpoint => (
                <div key={endpoint.id} className="bg-white dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700">
                  <div className="flex items-center gap-3 mb-2">
                    <span className={`px-3 py-1 rounded text-sm font-mono ${
                      endpoint.method === 'GET' ? 'bg-green-100 text-green-800' :
                      endpoint.method === 'POST' ? 'bg-blue-100 text-blue-800' :
                      endpoint.method === 'PUT' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {endpoint.method}
                    </span>
                    <code className="text-sm">{endpoint.endpoint}</code>
                  </div>
                  <h3 className="font-semibold mb-2">{endpoint.title}</h3>
                  {endpoint.content && (
                    <pre className="bg-gray-100 dark:bg-gray-900 p-3 rounded mt-2 text-xs overflow-x-auto">
                      {typeof endpoint.content === 'string' 
                        ? endpoint.content 
                        : JSON.stringify(endpoint.content, null, 2)}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
