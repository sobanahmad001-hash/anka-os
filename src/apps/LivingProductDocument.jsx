import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLivingProductDocument } from '../hooks/useLivingProductDocument.js'
import LPDTabs from '../components/LPDTabs'

const TABS = [
  { key: 'document', label: 'Document' },
  { key: 'changelog', label: 'Changelog' },
]

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function LivingProductDocument() {
  const { profile } = useAuth()
  const { document, changelog, loading, saving, error, isAdmin, updateDocument } = useLivingProductDocument()

  const [activeTab, setActiveTab] = useState('document')
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [changeNote, setChangeNote] = useState('')
  const [saveError, setSaveError] = useState(null)

  if (!profile) return null
  if (profile.role !== 'admin') return <Navigate to="/admin" replace />

  function handleEditStart() {
    setEditContent(document?.content || '')
    setChangeNote('')
    setSaveError(null)
    setEditing(true)
  }

  function handleEditCancel() {
    setEditing(false)
    setSaveError(null)
  }

  async function handleSave() {
    setSaveError(null)
    const result = await updateDocument(editContent, changeNote)
    if (result.error) {
      setSaveError(result.error)
    } else {
      setEditing(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Living Product Document</h1>
          <p className="text-gray-400 text-sm mt-1">
            Single source of truth for product vision, architecture, and decisions.
          </p>
          {document?.updated_at && (
            <p className="text-gray-500 text-xs mt-1">
              Last updated {formatDate(document.updated_at)}
              {document.updated_by && ' · by admin'}
            </p>
          )}
        </div>
        {isAdmin && !editing && (
          <button
            onClick={handleEditStart}
            className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white text-sm rounded-lg transition-colors"
          >
            <span>✏️</span> Edit Document
          </button>
        )}
      </div>

      {/* Global error */}
      {error && (
        <div className="mb-4 p-3 bg-red-900/40 border border-red-700/50 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-gray-800">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.key
                ? 'border-purple-500 text-purple-400'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            {tab.label}
            {tab.key === 'changelog' && changelog.length > 0 && (
              <span className="ml-2 px-1.5 py-0.5 text-xs bg-gray-700 rounded-full">
                {changelog.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-24">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500" />
        </div>
      )}

      {/* Document tab */}
      {!loading && activeTab === 'document' && (
        <div className="bg-gray-900 rounded-xl border border-gray-800">
          {editing ? (
            <div className="p-6 space-y-4">
              <textarea
                value={editContent}
                onChange={e => setEditContent(e.target.value)}
                rows={30}
                className="w-full bg-gray-950 border border-gray-700 rounded-lg p-4 text-sm text-gray-100 font-mono resize-y focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500"
                placeholder="Write the Living Product Document in Markdown..."
              />
              <div>
                <label className="block text-xs text-gray-400 mb-1">Change note (optional)</label>
                <input
                  type="text"
                  value={changeNote}
                  onChange={e => setChangeNote(e.target.value)}
                  placeholder="e.g. Updated architecture section"
                  className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500"
                />
              </div>
              {saveError && (
                <p className="text-red-400 text-sm">{saveError}</p>
              )}
              <div className="flex gap-3">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-5 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm rounded-lg transition-colors font-medium"
                >
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
                <button
                  onClick={handleEditCancel}
                  disabled={saving}
                  className="px-5 py-2 bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-gray-300 text-sm rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="p-6">
              {document?.content ? (
                <LPDTabs markdown={document.content} />
              ) : (
                <div className="text-center py-16 text-gray-500">
                  <p className="text-4xl mb-3">📄</p>
                  <p className="text-sm">No document yet.</p>
                  {isAdmin && (
                    <button
                      onClick={handleEditStart}
                      className="mt-4 text-purple-400 hover:text-purple-300 text-sm underline"
                    >
                      Create the first version
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Changelog tab */}
      {!loading && activeTab === 'changelog' && (
        <div className="space-y-3">
          {changelog.length === 0 ? (
            <div className="text-center py-16 text-gray-500 text-sm">
              No changelog entries yet.
            </div>
          ) : (
            changelog.map((entry, index) => (
              <div
                key={index}
                className="flex gap-4 bg-gray-900 border border-gray-800 rounded-xl px-5 py-4"
              >
                <div className="flex flex-col items-center">
                  <div className="w-2.5 h-2.5 rounded-full bg-purple-500 mt-1 shrink-0" />
                  {index < changelog.length - 1 && (
                    <div className="w-px flex-1 bg-gray-700 mt-2" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-200">{entry.note || 'Document updated'}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {entry.changed_by || 'Admin'} · {formatDate(entry.changed_at)}
                  </p>
                </div>
                {index === 0 && (
                  <span className="shrink-0 text-xs px-2 py-0.5 bg-purple-900/50 text-purple-300 border border-purple-700/50 rounded-full h-fit">
                    Latest
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  )
}
