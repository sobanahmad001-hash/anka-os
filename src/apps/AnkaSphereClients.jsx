import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
export default function AnkaSphereClients() {
  const { profile } = useAuth()
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('list')
  const [selectedClient, setSelectedClient] = useState(null)
  const [clientProjects, setClientProjects] = useState([])
  const [newClient, setNewClient] = useState({ name: '', email: '', company: '', portal_access: true })
  const [error, setError] = useState('')
  useEffect(() => { fetchClients() }, [])
  async function fetchClients() {
    setLoading(true)
    const { data } = await supabase
      .from('as_clients')
      .select('*')
      .order('created_at', { ascending: false })
    setClients(data || [])
    setLoading(false)
  }
  async function fetchClientDetail(client) {
    setSelectedClient(client)
    setView('detail')
    const { data } = await supabase
      .from('as_projects')
      .select('*')
      .eq('client_id', client.id)
      .order('created_at', { ascending: false })
    setClientProjects(data || [])
  }
  async function createClient() {
    setError('')
    if (!newClient.name || !newClient.email) { setError('Name and email required'); return }
    const { error: err } = await supabase.from('as_clients').insert(newClient)
    if (err) { setError(err.message); return }
    setNewClient({ name: '', email: '', company: '', portal_access: true })
    setView('list')
    fetchClients()
  }
  if (loading) return (
    <div className="flex items-center justify-center h-full">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500" />
    </div>
  )
  if (view === 'new') return (
    <div className="p-6 max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => setView('list')} className="text-gray-400 hover:text-white">←</button>
        <h2 className="text-xl font-bold text-white">New Client</h2>
      </div>
      <div className="bg-gray-800 rounded-xl p-6 space-y-4">
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <div>
          <label className="block text-sm text-gray-400 mb-1">Name *</label>
          <input value={newClient.name} onChange={e => setNewClient({...newClient, name: e.target.value})}
            className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            placeholder="John Smith" />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Email *</label>
          <input type="email" value={newClient.email} onChange={e => setNewClient({...newClient, email: e.target.value})}
            className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            placeholder="john@company.com" />
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Company</label>
          <input value={newClient.company} onChange={e => setNewClient({...newClient, company: e.target.value})}
            className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            placeholder="Acme Corp" />
        </div>
        <div className="flex items-center gap-3">
          <input type="checkbox" id="portal" checked={newClient.portal_access}
            onChange={e => setNewClient({...newClient, portal_access: e.target.checked})}
            className="rounded" />
          <label htmlFor="portal" className="text-sm text-gray-300">Enable portal access</label>
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={createClient}
            className="flex-1 bg-purple-600 hover:bg-purple-700 text-white rounded-lg px-4 py-2 text-sm font-medium transition-colors">
            Create Client
          </button>
          <button onClick={() => setView('list')} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Cancel</button>
        </div>
      </div>
    </div>
  )
  if (view === 'detail' && selectedClient) return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-gray-700">
        <button onClick={() => setView('list')} className="text-gray-400 hover:text-white">←</button>
        <div>
          <h2 className="text-lg font-bold text-white">{selectedClient.name}</h2>
          <p className="text-xs text-gray-400">{selectedClient.company || 'No company'} · {selectedClient.email}</p>
        </div>
        <span className={`ml-auto text-xs px-2 py-1 rounded-full ${selectedClient.portal_access ? 'bg-green-900/50 text-green-300' : 'bg-gray-700 text-gray-400'}`}>
          {selectedClient.portal_access ? 'Portal Active' : 'No Portal'}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <h3 className="text-sm font-semibold text-gray-300 mb-3">Projects ({clientProjects.length})</h3>
        {clientProjects.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">No projects for this client yet</p>
        ) : (
          <div className="space-y-3">
            {clientProjects.map(p => (
              <div key={p.id} className="bg-gray-800 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-medium text-white">{p.name}</h4>
                  <span className="text-xs text-gray-400">{p.current_phase?.replace(/_/g, ' ')}</span>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    p.status === 'active' ? 'bg-green-900/50 text-green-300' : 'bg-gray-700 text-gray-400'
                  }`}>{p.status}</span>
                  {p.deadline && <span className="text-xs text-gray-500">Due {new Date(p.deadline).toLocaleDateString()}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
        <div>
          <h2 className="text-lg font-bold text-white">AS Clients</h2>
          <p className="text-xs text-gray-400">{clients.length} clients</p>
        </div>
        <button onClick={() => setView('new')}
          className="bg-purple-600 hover:bg-purple-700 text-white text-sm px-4 py-2 rounded-lg transition-colors">
          + New Client
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {clients.length === 0 ? (
          <div className="text-center py-20 text-gray-500">
            <p className="text-5xl mb-4">👥</p>
            <p className="text-sm">No clients yet</p>
            <button onClick={() => setView('new')} className="mt-3 text-purple-400 text-sm hover:text-purple-300">+ Add first client</button>
          </div>
        ) : (
          <div className="space-y-3">
            {clients.map(client => (
              <div key={client.id} onClick={() => fetchClientDetail(client)}
                className="bg-gray-800 hover:bg-gray-750 border border-gray-700 hover:border-purple-500/50 rounded-xl p-4 cursor-pointer transition-all group">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-white group-hover:text-purple-300 transition-colors">{client.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{client.company || 'No company'} · {client.email}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${client.portal_access ? 'bg-green-900/50 text-green-300' : 'bg-gray-700 text-gray-400'}`}>
                    {client.portal_access ? 'Portal' : 'No portal'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
