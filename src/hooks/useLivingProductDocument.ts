import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useSession } from '@supabase/auth-helpers-react';

export interface ChangelogEntry {
  date: string;
  author: string;
  summary: string;
}

export interface LivingProductDocument {
  id: string;
  content: string;
  changelog: ChangelogEntry[];
  updated_at: string;
  updated_by: string;
}

export function useLivingProductDocument() {
  const session = useSession();
  const [document, setDocument] = useState<LivingProductDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const fetchDocument = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from('living_product_document')
      .select('*')
      .single();
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    setDocument(data as LivingProductDocument);
    setLoading(false);
  }, []);

  // Check admin role
  useEffect(() => {
    async function checkRole() {
      if (!session?.user) return setIsAdmin(false);
      const { data, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', session.user.id)
        .single();
      if (error || !data) return setIsAdmin(false);
      setIsAdmin(data.role === 'admin');
    }
    checkRole();
  }, [session]);

  useEffect(() => {
    fetchDocument();
  }, [fetchDocument]);

  const updateDocument = useCallback(
    async (content: string, changelogEntry: ChangelogEntry) => {
      if (!document) return;
      const newChangelog = Array.isArray(document.changelog)
        ? [changelogEntry, ...document.changelog]
        : [changelogEntry];
      const { error } = await supabase
        .from('living_product_document')
        .update({
          content,
          changelog: newChangelog,
          updated_at: new Date().toISOString(),
          updated_by: session?.user?.id || null,
        })
        .eq('id', document.id);
      if (error) {
        setError(error.message);
        return false;
      }
      setDocument({ ...document, content, changelog: newChangelog });
      return true;
    },
    [document, session]
  );

  return { document, loading, error, isAdmin, updateDocument, refetch: fetchDocument };
}
