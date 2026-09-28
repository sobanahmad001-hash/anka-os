import { useState } from 'react'
import OrganizationGate from '../components/OrganizationGate.jsx'
import { useOrganization } from '../context/OrganizationContext.jsx'
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
  return <OrganizationGate><ScopedLivingProductDocument /></OrganizationGate>
}

function ScopedLivingProductDocument() {
  const { activeMembership } = useOrganization()
  const { document, changelog, loading, saving, error, isAdmin, updateDocument } = useLivingProductDocument()

  const [activeTab, setActiveTab] = useState('document')
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [changeNote, setChangeNote] = useState('')
  const [saveError, setSaveError] = useState(null)

  if (!['system_owner', 'operations_admin', 'executive'].includes(activeMembership?.role)) {
    return <div className="p-6 text-sm text-[var(--anka-ink)]">Organization leadership access is required to read this document.</div>
  }

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
    <div className="workspace-page workspace-container bg-[var(--anka-canvas)]">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="workspace-title">Living Product Document</h1>
          <p className="text-[var(--anka-muted)] text-sm mt-1">
            Product vision, architecture, and decisions for the selected organization.
          </p>
          {document?.updated_at && (
            <p className="text-[var(--anka-muted)] text-xs mt-1">
              Last updated {formatDate(document.updated_at)}
              {document.updated_by && ' · by admin'}
            </p>
          )}
        </div>
        {isAdmin && !editing && (
          <button
            onClick={handleEditStart}
            className="workspace-button workspace-button-primary gap-2"
          >
            <span>✏️</span> Edit Document
          </button>
        )}
      </div>

      {/* Global error */}
      {error && (
        <div className="mb-4 p-3 bg-[var(--anka-danger-soft)] border border-[var(--anka-danger)] rounded-lg text-[var(--anka-danger)] text-sm">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-[var(--anka-line)]">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeTab === tab.key
                ? 'border-[var(--anka-violet)] text-[var(--anka-violet)]'
                : 'border-transparent text-[var(--anka-muted)] hover:text-[var(--anka-ink)]'
            }`}
          >
            {tab.label}
            {tab.key === 'changelog' && changelog.length > 0 && (
              <span className="ml-2 px-1.5 py-0.5 text-xs bg-[var(--anka-surface-raised)] rounded-full">
                {changelog.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center py-24">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--anka-violet)]" />
        </div>
      )}

      {/* Document tab */}
      {!loading && activeTab === 'document' && (
        <div className="workspace-card">
          {editing ? (
            <div className="p-6 space-y-4">
              <textarea
                value={editContent}
                onChange={e => setEditContent(e.target.value)}
                rows={30}
                className="w-full bg-[var(--anka-canvas)] border border-[var(--anka-line)] rounded-lg p-4 text-sm text-[var(--anka-ink)] font-mono resize-y focus:ring-2 focus:ring-[var(--anka-violet)] focus:border-[var(--anka-violet)]"
                placeholder="Write the Living Product Document in Markdown..."
              />
              <div>
                <label className="block text-xs text-[var(--anka-muted)] mb-1">Change note (optional)</label>
                <input
                  type="text"
                  value={changeNote}
                  onChange={e => setChangeNote(e.target.value)}
                  placeholder="e.g. Updated architecture section"
                  className="w-full bg-[var(--anka-canvas)] border border-[var(--anka-line)] rounded-lg px-3 py-2 text-sm text-[var(--anka-ink)] focus:ring-2 focus:ring-[var(--anka-violet)] focus:border-[var(--anka-violet)]"
                />
              </div>
              {saveError && (
                <p className="text-[var(--anka-danger)] text-sm">{saveError}</p>
              )}
              <div className="flex gap-3">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="workspace-button workspace-button-primary disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
                <button
                  onClick={handleEditCancel}
                  disabled={saving}
                  className="workspace-button disabled:opacity-50"
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
                <div className="text-center py-16 text-[var(--anka-muted)]">
                  <p className="text-4xl mb-3">📄</p>
                  <p className="text-sm">No document yet.</p>
                  {isAdmin && (
                    <button
                      onClick={handleEditStart}
                      className="mt-4 text-[var(--anka-violet)] hover:text-[var(--anka-ink)] text-sm underline"
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
            <div className="text-center py-16 text-[var(--anka-muted)] text-sm">
              No changelog entries yet.
            </div>
          ) : (
            changelog.map((entry, index) => (
              <div
                key={index}
                className="flex gap-4 workspace-card px-5 py-4"
              >
                <div className="flex flex-col items-center">
                  <div className="w-2.5 h-2.5 rounded-full bg-[var(--anka-violet)] mt-1 shrink-0" />
                  {index < changelog.length - 1 && (
                    <div className="w-px flex-1 bg-[var(--anka-surface-raised)] mt-2" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[var(--anka-ink)]">{entry.note || 'Document updated'}</p>
                  <p className="text-xs text-[var(--anka-muted)] mt-1">
                    {entry.changed_by || 'Admin'} · {formatDate(entry.changed_at)}
                  </p>
                </div>
                {index === 0 && (
                  <span className="shrink-0 text-xs px-2 py-0.5 bg-[var(--anka-violet-soft)] text-[var(--anka-violet)] border border-[var(--anka-violet)] rounded-full h-fit">
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
