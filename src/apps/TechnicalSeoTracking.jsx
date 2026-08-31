import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { INDEX_STATUSES, TRACKED_PAGE_TYPES, auditTrend, filterHealth, healthSummary, labelize, pageDepth } from '../data/technicalSeo.js'
import { technicalSeo } from '../data/technicalSeoRepository.js'

const INPUT = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500'
const BUTTON = 'rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:border-emerald-500 hover:text-white disabled:opacity-50'
const PRIMARY = 'rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50'
const EMPTY_PAGE = { pageUrl: '', pageType: 'service', parentPageId: '' }
const EMPTY_AUDIT = { auditDate: new Date().toISOString().slice(0, 10), indexed: '', indexStatus: '', mobileScore: '', desktopScore: '', schemaValid: '', issuesText: '', notes: '' }

function Panel({ title, description, children }) {
  return <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5"><h2 className="font-semibold text-white">{title}</h2>{description && <p className="mt-1 text-sm text-slate-500">{description}</p>}<div className="mt-4">{children}</div></section>
}

function Metric({ label, value }) {
  return <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4"><p className="text-xs uppercase tracking-wide text-slate-500">{label}</p><p className="mt-2 text-2xl font-semibold">{value}</p></div>
}

export default function TechnicalSeoTracking() {
  const [brands, setBrands] = useState([]); const [brandId, setBrandId] = useState('')
  const [pages, setPages] = useState([]); const [pageId, setPageId] = useState(''); const [audits, setAudits] = useState([])
  const [filters, setFilters] = useState({ pageType: '', indexStatus: '', attention: '', recency: '' })
  const [pageDraft, setPageDraft] = useState(EMPTY_PAGE); const [auditDraft, setAuditDraft] = useState(EMPTY_AUDIT)
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [message, setMessage] = useState('')

  useEffect(() => { technicalSeo.listBrands().then(rows => { setBrands(rows || []); setBrandId(rows?.[0]?.id || '') }).catch(e => setError(e.message)) }, [])

  async function loadBrand(id, preferredPage = '') {
    if (!id) return
    const rows = await technicalSeo.listHealth(id); setPages(rows || [])
    setPageId(preferredPage || rows?.[0]?.tracked_page_id || '')
  }
  useEffect(() => { loadBrand(brandId).catch(e => setError(e.message)) }, [brandId])
  useEffect(() => { if (!pageId) return setAudits([]); technicalSeo.listAudits(pageId).then(setAudits).catch(e => setError(e.message)) }, [pageId])

  const selected = pages.find(page => page.tracked_page_id === pageId)
  const visible = useMemo(() => filterHealth(pages, filters), [pages, filters])
  const summary = useMemo(() => healthSummary(pages), [pages])
  const trend = useMemo(() => auditTrend(audits), [audits])

  async function perform(action, success) {
    setBusy(true); setError(''); setMessage('')
    try { const result = await action(); await loadBrand(brandId, result?.tracked_page_id || result?.id || pageId); if (pageId) setAudits(await technicalSeo.listAudits(result?.tracked_page_id || pageId)); setMessage(success); return result }
    catch (e) { setError(e.message); return null } finally { setBusy(false) }
  }

  async function savePage(event) {
    event.preventDefault()
    const result = await perform(() => technicalSeo.savePage({ ...pageDraft, brandId }), 'Tracked page saved.')
    if (result) setPageDraft(EMPTY_PAGE)
  }

  async function saveAudit(event) {
    event.preventDefault()
    const issues = auditDraft.issuesText.split('\n').map(value => value.trim()).filter(Boolean)
    const result = await perform(() => technicalSeo.saveAudit({ ...auditDraft, pageId, issues }), 'Historical audit snapshot added.')
    if (result) setAuditDraft({ ...EMPTY_AUDIT, auditDate: new Date().toISOString().slice(0, 10) })
  }

  return <div className="h-full overflow-y-auto bg-slate-950 text-white">
    <header className="border-b border-slate-800 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.12),transparent_36%)] px-6 py-6"><div className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-400">Marketing Studio</p><h1 className="mt-1 text-3xl font-semibold">Technical SEO health</h1><p className="mt-2 text-sm text-slate-400">Track page hierarchy, immutable audits, indexation, and issue trends over time.</p></div><div className="flex gap-2"><Link to="/sphere/marketing/studio" className={BUTTON}>Marketing Studio</Link><select className={`${INPUT} min-w-56`} value={brandId} onChange={e => setBrandId(e.target.value)}>{brands.map(brand => <option key={brand.id} value={brand.id}>{brand.name}</option>)}</select></div></div></header>
    <main className="mx-auto max-w-7xl space-y-5 p-6">
      {error && <div className="rounded-xl border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-300">{error}</div>}{message && <div className="rounded-xl border border-emerald-900 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-300">{message}</div>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric label="Tracked pages" value={summary.total}/><Metric label="Needs attention" value={summary.attention}/><Metric label="Discovered, not indexed" value={summary.notIndexed}/><Metric label="Never audited" value={summary.unaudited}/></div>
      <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
        <Panel title="Page health" description="The latest visible audit drives this live view; historical snapshots remain unchanged."><div className="mb-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4"><select className={INPUT} value={filters.pageType} onChange={e => setFilters({ ...filters, pageType: e.target.value })}><option value="">All page types</option>{TRACKED_PAGE_TYPES.map(value => <option key={value} value={value}>{labelize(value)}</option>)}</select><select className={INPUT} value={filters.indexStatus} onChange={e => setFilters({ ...filters, indexStatus: e.target.value })}><option value="">All index states</option>{INDEX_STATUSES.map(value => <option key={value} value={value}>{labelize(value)}</option>)}</select><select className={INPUT} value={filters.attention} onChange={e => setFilters({ ...filters, attention: e.target.value })}><option value="">Any attention state</option><option value="yes">Needs attention</option><option value="no">Healthy / unknown</option></select><select className={INPUT} value={filters.recency} onChange={e => setFilters({ ...filters, recency: e.target.value })}><option value="">Any audit recency</option><option value="never">Never audited</option><option value="last_30">Audited in last 30 days</option><option value="days_31_90">Audited 31–90 days ago</option><option value="over_90">Audited over 90 days ago</option></select></div><div className="space-y-2">{visible.map(page => <button key={page.tracked_page_id} onClick={() => setPageId(page.tracked_page_id)} style={{ paddingLeft: `${16 + pageDepth(page, pages) * 18}px` }} className={`w-full rounded-xl border p-3 text-left ${pageId === page.tracked_page_id ? 'border-emerald-500 bg-emerald-950/20' : 'border-slate-800 bg-slate-950/50'}`}><div className="flex flex-wrap items-center justify-between gap-2"><p className="break-all text-sm font-medium">{page.page_url}</p><span className={`rounded-full px-2 py-1 text-[10px] ${page.needs_attention ? 'bg-amber-950 text-amber-300' : 'bg-slate-800 text-slate-400'}`}>{page.latest_audit_id ? labelize(page.index_status || 'unknown') : 'Never audited'}</span></div><p className="mt-1 text-xs text-slate-500">{labelize(page.page_type)} · {page.open_issue_count} issues{page.audit_date ? ` · audited ${page.audit_date}` : ''}</p></button>)}{!visible.length && <p className="text-sm text-slate-500">No pages match these filters.</p>}</div></Panel>
        <Panel title="Add tracked page" description="URLs are unique within the selected brand."><form className="grid gap-3" onSubmit={savePage}><input type="url" required className={INPUT} placeholder="https://example.com/service" value={pageDraft.pageUrl} onChange={e => setPageDraft({ ...pageDraft, pageUrl: e.target.value })}/><select className={INPUT} value={pageDraft.pageType} onChange={e => setPageDraft({ ...pageDraft, pageType: e.target.value })}>{TRACKED_PAGE_TYPES.map(value => <option key={value} value={value}>{labelize(value)}</option>)}</select><select className={INPUT} value={pageDraft.parentPageId} onChange={e => setPageDraft({ ...pageDraft, parentPageId: e.target.value })}><option value="">No parent page</option>{pages.map(page => <option key={page.tracked_page_id} value={page.tracked_page_id}>{page.page_url}</option>)}</select><button disabled={busy || !brandId} className={PRIMARY}>Add page</button></form></Panel>
      </div>
      {selected && <div className="grid gap-5 xl:grid-cols-[1fr_1fr]"><Panel title="Audit history" description={selected.page_url}><div className="mb-4 flex flex-wrap gap-2"><button disabled={busy} onClick={() => perform(() => technicalSeo.inspectPage(pageId), 'Search Console inspection saved as today’s snapshot.')} className={PRIMARY}>Inspect with Search Console</button><span className="self-center text-xs text-slate-500">Read-only URL Inspection API; manual Core Web Vitals remain separate.</span></div><div className="mb-4"><p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Audit trend over time</p><div className="flex gap-2 overflow-x-auto pb-2">{trend.map(point => <div key={point.id} className="min-w-36 rounded-xl border border-slate-800 bg-slate-950/70 p-3"><p className="text-xs font-medium text-slate-300">{point.date}</p><p className="mt-1 text-[11px] text-emerald-300">{labelize(point.indexStatus)}</p><p className="mt-2 text-[11px] text-slate-500">{point.issueCount} issues · M {point.mobile ?? '—'} · D {point.desktop ?? '—'}</p><p className="mt-1 text-[10px] text-slate-600">{labelize(point.sourceType)}</p></div>)}{!trend.length && <p className="text-sm text-slate-500">Trend appears after the first dated audit.</p>}</div></div><div className="space-y-2">{audits.map(audit => <div key={audit.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3"><div className="flex justify-between gap-3"><p className="text-sm font-medium">{audit.audit_date} · {labelize(audit.index_status || 'unknown')}</p><span className="text-xs text-slate-500">{labelize(audit.source_type)}</span></div><p className="mt-2 text-xs text-slate-400">Mobile {audit.core_web_vitals_mobile ?? '—'} · Desktop {audit.core_web_vitals_desktop ?? '—'} · Schema {audit.schema_valid === null ? 'unknown' : audit.schema_valid ? 'valid' : 'invalid'}</p><p className="mt-1 text-xs text-amber-300">{(audit.issues || []).join(' · ') || 'No manual issues recorded'}</p>{audit.notes && <p className="mt-2 text-xs leading-5 text-slate-500">{audit.notes}</p>}</div>)}{!audits.length && <p className="text-sm text-slate-500">No audits recorded.</p>}</div></Panel>
        <Panel title="Add manual audit" description="One append-only snapshot per page and date."><form className="grid gap-3" onSubmit={saveAudit}><input type="date" required className={INPUT} value={auditDraft.auditDate} onChange={e => setAuditDraft({ ...auditDraft, auditDate: e.target.value })}/><div className="grid grid-cols-2 gap-3"><select className={INPUT} value={auditDraft.indexed} onChange={e => { const indexed = e.target.value; setAuditDraft({ ...auditDraft, indexed, indexStatus: indexed === 'true' ? 'indexed' : auditDraft.indexStatus === 'indexed' ? '' : auditDraft.indexStatus }) }}><option value="">Indexed unknown</option><option value="true">Indexed</option><option value="false">Not indexed</option></select><select className={INPUT} value={auditDraft.indexStatus} onChange={e => setAuditDraft({ ...auditDraft, indexStatus: e.target.value, indexed: e.target.value === 'indexed' ? 'true' : auditDraft.indexed })}><option value="">Index status unknown</option>{INDEX_STATUSES.map(value => <option key={value} value={value}>{labelize(value)}</option>)}</select></div><div className="grid grid-cols-2 gap-3"><input type="number" min="0" max="100" step="0.01" className={INPUT} placeholder="Mobile score" value={auditDraft.mobileScore} onChange={e => setAuditDraft({ ...auditDraft, mobileScore: e.target.value })}/><input type="number" min="0" max="100" step="0.01" className={INPUT} placeholder="Desktop score" value={auditDraft.desktopScore} onChange={e => setAuditDraft({ ...auditDraft, desktopScore: e.target.value })}/></div><select className={INPUT} value={auditDraft.schemaValid} onChange={e => setAuditDraft({ ...auditDraft, schemaValid: e.target.value })}><option value="">Schema unknown</option><option value="true">Schema valid</option><option value="false">Schema invalid</option></select><textarea className={`${INPUT} min-h-24`} placeholder="Issues, one per line" value={auditDraft.issuesText} onChange={e => setAuditDraft({ ...auditDraft, issuesText: e.target.value })}/><textarea className={`${INPUT} min-h-24`} placeholder="Audit notes" value={auditDraft.notes} onChange={e => setAuditDraft({ ...auditDraft, notes: e.target.value })}/><button disabled={busy} className={PRIMARY}>Add audit snapshot</button></form></Panel></div>}
    </main>
  </div>
}
