import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";
import { useUser } from "../hooks/useUser";

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
  const [doc, setDoc] = useState<LivingProductDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { user, profile } = useUser();

  const fetchDoc = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("living_product_document")
      .select("*")
      .single();
    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }
    setDoc(data as LivingProductDocument);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchDoc();
  }, [fetchDoc]);

  const updateDoc = useCallback(
    async (newContent: string, changelogEntry: ChangelogEntry) => {
      if (!doc) return;
      const newChangelog = [changelogEntry, ...(doc.changelog || [])];
      const { data, error } = await supabase
        .from("living_product_document")
        .update({
          content: newContent,
          changelog: newChangelog,
          updated_at: new Date().toISOString(),
          updated_by: user?.id,
        })
        .eq("id", doc.id)
        .select("*")
        .single();
      if (error) {
        setError(error.message);
        return;
      }
      setDoc(data as LivingProductDocument);
    },
    [doc, user]
  );

  return { doc, loading, error, fetchDoc, updateDoc, user, profile };
}
