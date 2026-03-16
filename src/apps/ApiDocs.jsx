import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import Card from '../components/Card'
import Badge from '../components/Badge'
import EmptyState from '../components/EmptyState'

function methodVariant(method) {
  const value = String(method || '').toUpperCase()
  if (value === 'GET') return 'success'
  if (value === 'POST') return 'primary'
  if (value === 'PUT' || value === 'PATCH') return 'warning'
  if (value === 'DELETE') return 'danger'
  return 'default'
}

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
      setEndpoints([])
    } else {
      setEndpoints(data || [])
    }

    setLoading(false)
  }

  const grouped = useMemo(() => {
    return endpoints.reduce((acc, endpoint) => {
      const category = endpoint.category || 'General'
      if (!acc[category]) acc[category] = []
      acc[category].push(endpoint)
      return acc
    }, {})
  }, [endpoints])

  if (loading) return <div className="p-6">Loading development API context...</div>

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">API Docs</h1>
          <p className="mt-1 text-gray-600 dark:text-gray-400">
            Endpoint and integration reference for technical execution inside the Development environment.
          </p>
        </div>

        <div className="rounded-lg border border-gray-200 dark:border-gray-700 px-4 py-3 bg-white dark:bg-gray-800">
          <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
            Support Surface
          </div>
          <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
            Reference, not product identity
          </div>
          <div className="text-sm text-gray-500 dark:text-gray-400">
            Keep execution unblocked with quick API context
          </div>
        </div>
      </div>

      {Object.keys(grouped).length === 0 ? (
        <Card>
          <EmptyState
            icon="📖"
            title="No API endpoints documented"
            description="API categories and endpoint notes will appear here as the development reference surface grows."
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([category, items]) => (
            <Card
              key={category}
              title={category}
              subtitle={`${items.length} endpoint${items.length === 1 ? '' : 's'} in this category`}
            >
              <div className="space-y-4">
                {items.map((endpoint) => (
                  <div
                    key={endpoint.id}
                    className="rounded-lg border border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-900"
                  >
                    <div className="flex flex-wrap items-center gap-3 mb-3">
                      <Badge variant={methodVariant(endpoint.method)}>
                        {String(endpoint.method || 'N/A').toUpperCase()}
                      </Badge>
                      <code className="text-sm text-gray-900 dark:text-gray-100">
                        {endpoint.endpoint || '/unknown'}
                      </code>
                    </div>

                    <div className="text-sm font-semibold text-gray-900 dark:text-white">
                      {endpoint.title || 'Untitled endpoint'}
                    </div>

                    {endpoint.description && (
                      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                        {endpoint.description}
                      </p>
                    )}

                    {endpoint.content && (
                      <pre className="mt-3 rounded-lg bg-gray-100 dark:bg-gray-950 p-4 text-xs overflow-x-auto text-gray-800 dark:text-gray-200">
{typeof endpoint.content === 'string'
  ? endpoint.content
  : JSON.stringify(endpoint.content, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
