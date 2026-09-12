import { websitePageKey } from '../data/contentStudio.js'

const OPTIONAL_KINDS = new Set(['text_optional', 'number_optional', 'date_optional', 'textarea_optional'])

function requestLabel(request) {
  const brief = String(request.brief || '').trim()
  const summary = brief.length > 72 ? `${brief.slice(0, 69)}…` : brief
  return `${request.mode === 'general' ? 'Standalone' : 'Project'} ${request.format.replaceAll('_', ' ')} · ${summary || request.id}`
}

export default function KeywordStrategyEditor({
  field,
  records = [],
  architectureVersion,
  contentRequests = [],
  issues = new Map(),
  warnings = new Map(),
  inputClass,
  buttonClass,
  onAdd,
  onChange,
  onRemove,
}) {
  const pageChoices = (architectureVersion?.content?.pages || []).map(page => {
    const pageKey = websitePageKey(page)
    return {
      value: pageKey,
      label: `${page.title || page.slug || 'Untitled page'} · ${page.slug || pageKey}`,
      slug: String(page.slug || ''),
    }
  }).filter(choice => choice.value)
  const requestChoices = contentRequests.map(request => ({ value: request.id, label: requestLabel(request) }))

  return <div>
    <div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">{field.label}</p><button type="button" className={buttonClass} onClick={onAdd}>{field.addLabel}</button></div>
    {issues.has('form') && <p role="alert" className="mt-3 text-xs text-red-300">{issues.get('form')}</p>}
    <div className="mt-3 space-y-4">{records.map((record, index) => <div key={index} className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
      <div className="mb-4 flex items-center justify-between gap-3"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-400">Keyword {index + 1}</p><button type="button" onClick={() => onRemove(index)} className="text-xs font-semibold text-red-300">Remove</button></div>
      <div className="grid gap-4 md:grid-cols-2">{field.recordFields.map(([key, label, kind, options]) => {
        const required = !OPTIONAL_KINDS.has(kind)
        const choices = kind === 'keyword_target'
          ? record.target_kind === 'page' ? pageChoices : record.target_kind === 'content_request' ? requestChoices : []
          : options || []
        const wide = kind === 'textarea_optional'
        const measured = ['search_volume', 'difficulty', 'observation_date'].includes(key)
        const inputType = kind === 'number_optional' ? 'number' : kind === 'date_optional' ? 'date' : 'text'
        const setValue = value => {
          if (key === 'target_kind') {
            onChange(index, { ...record, target_kind: value, target_id: '', target_page_slug: '' })
            return
          }
          if (kind === 'keyword_target') {
            const choice = choices.find(item => item.value === value)
            onChange(index, { ...record, target_id: value, target_page_slug: choice?.slug || '' })
            return
          }
          onChange(index, { ...record, [key]: value })
        }
        return <label key={key} className={`text-xs font-semibold uppercase tracking-[0.12em] text-slate-500 ${wide ? 'md:col-span-2' : ''}`}>{label}{measured && (record[key] === '' || record[key] === null || record[key] === undefined) && <span className="ml-2 font-normal normal-case tracking-normal text-slate-600">Not available</span>}{kind === 'textarea_optional' ? <textarea rows="3" className={`${inputClass} mt-2 normal-case tracking-normal`} value={record[key] || ''} onChange={event => setValue(event.target.value)} /> : kind === 'select' || kind === 'keyword_target' ? <select required={required} className={`${inputClass} mt-2 normal-case tracking-normal`} value={record[key] || ''} onChange={event => setValue(event.target.value)}><option value="">{kind === 'keyword_target' ? 'Select existing target' : 'Select one'}</option>{choices.map(choice => { const value = typeof choice === 'object' ? choice.value : choice; const choiceLabel = typeof choice === 'object' ? choice.label : choice; return <option key={value} value={value}>{choiceLabel}</option> })}</select> : <input required={required} type={inputType} min={kind === 'number_optional' ? '0' : undefined} step={kind === 'number_optional' ? 'any' : undefined} className={`${inputClass} mt-2 normal-case tracking-normal`} value={record[key] ?? ''} onChange={event => setValue(event.target.value)} />}</label>
      })}</div>
      {record.target_kind === 'page' && record.target_page_slug && !record.target_id && <p className="mt-3 text-xs text-amber-300">Legacy target “{record.target_page_slug}” must be reselected from an exact Website architecture version.</p>}
      {warnings.has(index) && <p className="mt-3 text-xs text-amber-300">{warnings.get(index)}</p>}
      {issues.has(index) && <p role="alert" className="mt-3 text-xs text-red-300">{issues.get(index)}</p>}
    </div>)}{!records.length && <div className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">Add at least one keyword.</div>}</div>
  </div>
}
