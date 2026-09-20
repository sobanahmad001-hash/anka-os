const INPUT = 'w-full rounded-xl border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-white'
const BUTTON = 'rounded-xl border border-slate-700 px-3 py-2 text-xs text-slate-200'

export default function WebsitePageBriefEditor({ page, versions = [], artifacts = new Map(), onChange }) {
  const sections = page.sections || []
  const briefComplete = Boolean(page.audience?.trim() && sections.length && page.conversion_action?.kind
    && sections.every(section => section.heading?.trim() && section.purpose?.trim()))
  const sourceVersions = versions.filter(version => artifacts.get(version.artifact_id)?.artifact_type !== 'keyword_strategy')
  const keywordVersions = versions.filter(version => artifacts.get(version.artifact_id)?.artifact_type === 'keyword_strategy')
  const label = version => [artifacts.get(version.artifact_id)?.artifact_type?.replaceAll('_', ' '), 'v' + version.version_number, version.id].join(' · ')
  const updateSection = (index, patch) => onChange({ ...page, sections: sections.map((section, i) => i === index ? { ...section, ...patch } : section) })
  function moveSection(index, direction) {
    const nextIndex = index + direction
    if (nextIndex < 0 || nextIndex >= sections.length) return
    const next = [...sections]
    ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
    onChange({ ...page, sections: next })
  }
  return <section className="mt-5 border-t border-slate-800 pt-5" aria-label={'Page brief for ' + (page.title || page.page_key)}>
    <h4 className="text-sm font-semibold text-white">Page brief · {briefComplete ? 'Complete for later generation' : 'Draft incomplete'}</h4>
    {!briefComplete && <p className="mt-1 text-xs text-amber-300">A complete brief needs an audience, at least one section with heading and purpose, and an explicit conversion choice.</p>}
    <label className="mt-3 block text-xs text-slate-400">Audience (blank means undecided)<textarea rows="2" maxLength="1200" className={INPUT + ' mt-1'} value={page.audience || ''} onChange={event => onChange({ ...page, audience: event.target.value })} /></label>
    <div className="mt-4 flex items-center justify-between"><h5 className="text-xs font-semibold uppercase text-slate-400">Ordered sections</h5><button type="button" className={BUTTON} disabled={sections.length >= 40} onClick={() => onChange({ ...page, sections: [...sections, { section_key: 'section:' + globalThis.crypto.randomUUID(), heading: '', purpose: '', cta: null }] })}>Add section</button></div>
    <div className="mt-3 space-y-3">{sections.map((section, index) => <div key={section.section_key} className="rounded-xl border border-slate-800 p-3">
      <div className="flex items-center justify-between gap-2 text-xs text-slate-400"><span>Section {index + 1}</span><div className="flex gap-2"><button type="button" disabled={index === 0} onClick={() => moveSection(index, -1)}>Earlier</button><button type="button" disabled={index === sections.length - 1} onClick={() => moveSection(index, 1)}>Later</button><button type="button" className="text-red-300" onClick={() => onChange({ ...page, sections: sections.filter((_, i) => i !== index) })}>Remove</button></div></div>
      <label className="mt-2 block text-xs text-slate-400">Heading<input required maxLength="240" className={INPUT + ' mt-1'} value={section.heading || ''} onChange={event => updateSection(index, { heading: event.target.value })} /></label>
      <label className="mt-2 block text-xs text-slate-400">Purpose<textarea required maxLength="1200" rows="2" className={INPUT + ' mt-1'} value={section.purpose || ''} onChange={event => updateSection(index, { purpose: event.target.value })} /></label>
      <label className="mt-2 block text-xs text-slate-400">Optional CTA<input maxLength="500" className={INPUT + ' mt-1'} value={section.cta || ''} onChange={event => updateSection(index, { cta: event.target.value })} /></label>
    </div>)}</div>
    <label className="mt-4 block text-xs text-slate-400">Conversion action<select className={INPUT + ' mt-1'} value={page.conversion_action?.kind || ''} onChange={event => onChange({ ...page, conversion_action: event.target.value ? { kind: event.target.value, text: event.target.value === 'none' ? null : '' } : null })}><option value="">Undecided</option><option value="none">Explicitly none</option><option value="action">Action</option></select></label>
    {page.conversion_action?.kind === 'action' && <label className="mt-2 block text-xs text-slate-400">Action text<input required maxLength="500" className={INPUT + ' mt-1'} value={page.conversion_action.text || ''} onChange={event => onChange({ ...page, conversion_action: { kind: 'action', text: event.target.value } })} /></label>}
    <div className="mt-4"><p className="text-xs font-semibold text-slate-400">Exact source versions</p><p className="mt-1 text-xs text-slate-600">Readable versions in this engagement; empty means none linked yet.</p><div className="mt-2 grid gap-2 sm:grid-cols-2">{sourceVersions.map(version => <label key={version.id} className="flex items-start gap-2 text-xs text-slate-300"><input type="checkbox" checked={(page.source_version_ids || []).includes(version.id)} onChange={event => onChange({ ...page, source_version_ids: event.target.checked ? [...(page.source_version_ids || []), version.id] : (page.source_version_ids || []).filter(id => id !== version.id) })} /><span>{label(version)}</span></label>)}</div></div>
    <label className="mt-4 block text-xs text-slate-400">Exact keyword strategy version<select className={INPUT + ' mt-1'} value={page.keyword_strategy_version_id || ''} onChange={event => onChange({ ...page, keyword_strategy_version_id: event.target.value || null })}><option value="">None linked yet</option>{keywordVersions.map(version => <option key={version.id} value={version.id}>{label(version)}</option>)}</select></label>
  </section>
}
