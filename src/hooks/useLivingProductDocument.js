import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'

export function useLivingProductDocument() {
  const { user, profile } = useAuth()
  const [document, setDocument] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [saving, setSaving] = useState(false)

  const isAdmin = profile?.role === 'admin'

  const fetchDocument = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: fetchError } = await supabase
      .from('living_product_document')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (fetchError) {
      setError(fetchError.message)
    } else {
      setDocument(data)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchDocument()
  }, [fetchDocument])

  async function updateDocument(newContent, changeNote = '') {
    if (!isAdmin || !user?.id) return { error: 'Permission denied' }

    setSaving(true)
    setError(null)

    const now = new Date().toISOString()
    const entry = {
      changed_at: now,
      changed_by: profile?.full_name || user.email,
      note: changeNote || 'Document updated',
    }

    let result
    if (document?.id) {
      const updatedChangelog = [entry, ...(document.changelog || [])]
      result = await supabase
        .from('living_product_document')
        .update({
          content: newContent,
          changelog: updatedChangelog,
          updated_at: now,
          updated_by: user.id,
        })
        .eq('id', document.id)
        .select()
        .single()
    } else {
      result = await supabase
        .from('living_product_document')
        .insert({
          content: newContent,
          changelog: [entry],
          updated_at: now,
          updated_by: user.id,
        })
        .select()
        .single()
    }

    if (result.error) {
      setError(result.error.message)
      setSaving(false)
      return { error: result.error.message }
    }

    setDocument(result.data)
    setSaving(false)
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
