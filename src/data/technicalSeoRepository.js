import { supabase } from '../lib/supabase.js'

async function dataOrThrow(query) {
  const { data, error } = await query
  if (error) throw new Error(error.message || 'Technical SEO query failed')
  return data
}

async function invoke(action, input = {}) {
  const { data, error } = await supabase.functions.invoke('technical-seo', { body: { action, ...input } })
  if (error) throw new Error(error.message || 'Technical SEO function failed')
  if (data?.error) throw new Error(data.error)
  return data?.data
}

export const technicalSeo = Object.freeze({
  listBrands: () => dataOrThrow(supabase.from('brands').select('id, organization_id, name').order('name')),
  listHealth: brandId => dataOrThrow(supabase.from('tracked_page_current_health').select('*')
    .eq('brand_id', brandId).order('page_url')),
  listAudits: pageId => dataOrThrow(supabase.from('tracked_page_audits').select('*')
    .eq('tracked_page_id', pageId).order('audit_date', { ascending: false }).order('created_at', { ascending: false })),
  savePage: input => invoke('save_page', input),
  saveAudit: input => invoke('save_audit', input),
  inspectPage: pageId => invoke('inspect_page', { pageId }),
})
