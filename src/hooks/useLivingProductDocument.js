import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useOrganization } from '../context/OrganizationContext.jsx'

export function useLivingProductDocument() {
  const { user, profile } = useAuth()
  const { activeOrganizationId, activeMembership, requestSignal, scopeRevision, handleOrganizationAccessError } = useOrganization()
  const [document, setDocument] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const isAdmin = ['system_owner', 'operations_admin'].includes(activeMembership?.role)

  const fetchDocument = useCallback(async () => {
    if (!activeOrganizationId || requestSignal.aborted) return
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await supabase
      .from('living_product_document')
      .select('*')
      .eq('organization_id', activeOrganizationId)
      .abortSignal(requestSignal)
      .maybeSingle()

    if (requestSignal.aborted) return
    if (fetchError) {
      handleOrganizationAccessError(fetchError)
      setError(fetchError.message)
    } else {
      setDocument(data)
    }
    setLoading(false)
  }, [activeOrganizationId, handleOrganizationAccessError, requestSignal, scopeRevision])

  useEffect(() => {
    fetchDocument()
  }, [fetchDocument])

  async function updateDocument(newContent, changeNote = '') {
    if (!isAdmin || !user?.id || !activeOrganizationId || requestSignal.aborted) return { error: 'Permission denied' }

    setSaving(true)
    setError(null)
    const now = new Date().toISOString()
    const entry = {
      changed_at: now,
      changed_by: profile?.full_name || user.email || 'Organization administrator',
      note: changeNote.trim().slice(0, 200) || 'Document updated',
    }
    const payload = {
      content: newContent,
      changelog: [entry, ...(document?.changelog || [])],
      updated_at: now,
      updated_by: user.id,
      version: (document?.version || 0) + 1,
    }

    const result = document?.id
      ? await supabase.from('living_product_document').update(payload)
        .eq('id', document.id).eq('organization_id', activeOrganizationId).eq('version', document.version)
        .select().maybeSingle()
      : await supabase.from('living_product_document').insert({ ...payload, organization_id: activeOrganizationId })
        .select().single()

    setSaving(false)
    if (requestSignal.aborted) return { error: 'Organization changed; reopen the document' }
    if (result.error || !result.data) {
      const message = result.error?.code === '23505' || !result.data
        ? 'The document changed elsewhere. Reload it before saving.'
        : result.error.message
      setError(message)
      if (!result.data) fetchDocument()
      return { error: message }
    }
    setDocument(result.data)
    return { data: result.data }
  }

  return {
    document,
    changelog: document?.changelog || [],
    loading,
    saving,
    error,
    isAdmin,
    updateDocument,
    refetch: fetchDocument,
  }
}
