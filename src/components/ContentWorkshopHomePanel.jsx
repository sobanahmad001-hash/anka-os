import { useEffect, useMemo, useRef, useState } from 'react'

import {
  CONTENT_HOME_GROUPS, buildContentHomeIndex, contentHomeAccessState, contentSourceReadiness, recordedContentSourceSelections,
} from '../data/contentWorkshopHome.js'
import { CONTENT_ARTIFACT_FORMS } from '../data/contentStudio.js'
import { isWriterContent } from '../data/contentWriter.js'

const BUTTON = 'rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:cursor-not-allowed disabled:opacity-50'
const PRIMARY = 'rounded-xl bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-300'
const STATUS = {
  missing: 'bg-slate-800 text-slate-300', available: 'bg-blue-950 text-blue-300', approved: 'bg-emerald-950 text-emerald-300',
  changed_since_use: 'bg-amber-950 text-amber-300', selection_required: 'bg-amber-950 text-amber-300', invalid_selection: 'bg-red-950 text-red-300',
}

function relation(value) { return Array.isArray(value) ? value[0] || null : value || null }
function label(value) { return String(value || '').replaceAll('_', ' ').replace(/\b\w/g, letter => letter.toUpperCase()) }
function displayDate(value) { return value ? new Date(value).toLocaleString() : 'No saved update' }
function readinessEffect(status) {
  return {
    missing: 'No current exact version is available. This is informational until an action requires it.',
    available: 'A current exact version is available but is not approved.',
    approved: 'The current exact version has an approval record.',
    changed_since_use: 'The current exact version differs from the version previously used.',
    selection_required: 'More than one artifact root matches; choose one explicitly.',
    invalid_selection: 'The saved selection no longer resolves safely.',
  }[status] || ''
}

function homeContext(workspace) {
  const engagement = workspace?.engagement
  return {
    organizationId: engagement?.organization_id || '', projectId: engagement?.project_id || '',
    engagementId: engagement?.id || '', brandId: engagement?.brand_id || '',
    activeServices: (workspace?.contentServices || []).map(service => ({
      id: service.id, status: service.status, departmentId: relation(service.service_catalog)?.department_id,
    })),
  }
}

export default function ContentWorkshopHomePanel({
  workspace, loadState = 'ready', stale = false, error = '', onRetry, onOpenEditor, onOpenBrief, onNewContent,
}) {
  const context = homeContext(workspace)
  const contextKey = `${context.organizationId}:${context.engagementId}`
  const [selectedItemId, setSelectedItemId] = useState('')
  const [sourceSelections, setSourceSelections] = useState({})
  const detailHeading = useRef(null)
  const groups = useMemo(() => buildContentHomeIndex(workspace || {}), [workspace])
  const allItems = useMemo(() => groups.filter(group => group.id !== 'review').flatMap(group => group.items), [groups])
  const selectedItem = allItems.find(item => item.id === selectedItemId) || null
  const selectedVersion = (workspace?.versions || []).find(version => version.id === selectedItem?.currentVersionId) || null
  const recordedSelections = recordedContentSourceSelections(workspace, selectedVersion)
  const access = contentHomeAccessState(context)
  const typeCounts = useMemo(() => new Map((workspace?.artifacts || []).map(item => item.artifact_type)
    .map((type, _index, types) => [type, types.filter(candidate => candidate === type).length])), [workspace])
  const writerTarget = selectedItem?.contentType === 'content' && isWriterContent(selectedVersion?.content)
  const editorTarget = writerTarget ? 'writer' : selectedItem && typeCounts.get(selectedItem.contentType) === 1
    && CONTENT_ARTIFACT_FORMS[selectedItem.contentType] ? 'artifacts' : ''

  useEffect(() => {
    setSelectedItemId(''); setSourceSelections({})
  }, [contextKey])

  useEffect(() => {
    if (selectedItemId) detailHeading.current?.focus()
  }, [selectedItemId])

  if (loadState === 'loading') return <HomeState title="Loading Content home" detail="The selected authorized context is being resolved." />
  if (loadState === 'denied') return <HomeState alert title="You do not have access to this Content work" detail="Return to permitted work; hidden records are not shown." />
  if (loadState === 'error' && !workspace) return <HomeState alert title="Content home could not be loaded" detail={error || 'Try again while keeping the selected context.'} action={onRetry} />
  if (!workspace) return <HomeState title="No Content work selected" detail="Choose an authorized engagement. Content Studio will not select one silently." />

  const empty = allItems.length === 0
  return <section aria-labelledby="content-home-title" className="space-y-5">
    <header className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-400">Content B01</p>
        <h2 id="content-home-title" className="mt-1 text-2xl font-semibold text-white">Content home</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">Browse the current engagement’s Content records, select exact saved versions, and see source readiness without imposing unrelated gates.</p>
      </div><div className="flex flex-wrap gap-2"><button type="button" className={PRIMARY} disabled={stale} onClick={onNewContent}>New content</button><button type="button" className={BUTTON} onClick={onOpenBrief}>Open brief</button><a className={BUTTON} href="/sphere/quick-tasks">Start private exploration</a></div></div>
      <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <Meta label="Organization" value={context.organizationId} /><Meta label="Project" value={context.projectId} />
        <Meta label="Engagement" value={workspace.engagement?.name || context.engagementId} /><Meta label="Brand" value={workspace.engagement?.brands?.name || context.brandId} />
      </dl>
      {!access.canCreateOfficial && <p role="status" className="mt-4 text-sm text-amber-300">Official creation unavailable: {access.reason}</p>}
      {stale && <div role="status" className="mt-4 flex flex-wrap items-center gap-3 text-sm text-amber-300"><p>Fresh data could not be loaded. This last verified snapshot is read-only until retry succeeds.</p><button type="button" className={BUTTON} onClick={onRetry}>Retry current Content work</button></div>}
    </header>

    {empty ? <div className="rounded-2xl border border-dashed border-slate-700 px-6 py-14 text-center">
      <h3 className="font-semibold text-slate-200">No Content records in this engagement</h3>
      <p className="mt-2 text-sm text-slate-500">This is an empty result, not a permission denial. Start a permitted request or open the brief.</p>
    </div> : <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
      <nav aria-label="Project Content index" className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
        {groups.map(group => <section key={group.id} aria-labelledby={`content-home-${group.id}`}>
          <div className="flex items-center justify-between gap-3"><h3 id={`content-home-${group.id}`} className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">{group.label}</h3><span className="text-xs text-slate-600">{group.items.length}</span></div>
          {group.items.length ? <div className="mt-2 space-y-2">{group.items.map(item => <button type="button" key={`${group.id}:${item.id}`} onClick={() => setSelectedItemId(item.id)} aria-pressed={selectedItem?.id === item.id} className={`w-full rounded-xl border px-3 py-3 text-left focus:outline-none focus:ring-2 focus:ring-amber-400 ${selectedItem?.id === item.id ? 'border-amber-500/60 bg-amber-950/20' : 'border-slate-800 bg-slate-950/50 hover:border-slate-700'}`}>
            <span className="block text-sm font-semibold text-slate-200">{item.title}</span>
            <span className="mt-1 block text-[11px] text-slate-500">{label(item.contentType)} · {item.currentVersionNumber ? `version ${item.currentVersionNumber}` : 'no saved version'}</span>
            <span className="mt-1 block text-[11px] text-slate-500">{item.reviewLabel} · {displayDate(item.updatedAt)}</span>
          </button>)}</div> : <p className="mt-2 text-xs text-slate-600">No items</p>}
        </section>)}
      </nav>

      <div className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
        {!selectedItem ? <div className="py-16 text-center"><h3 className="font-semibold text-slate-200">Select a Content record</h3><p className="mt-2 text-sm text-slate-500">Nothing has been selected automatically. Choose an item from the index to inspect its exact current version.</p></div> : <>
          <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-amber-400">Explicit selection</p><h3 ref={detailHeading} tabIndex="-1" className="mt-1 text-xl font-semibold text-white outline-none">{selectedItem.title}</h3><p className="mt-2 text-sm text-slate-400">{label(selectedItem.contentType)} · owner {selectedItem.ownerId || 'not recorded'} · {displayDate(selectedItem.updatedAt)}</p></div><span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${selectedItem.reviewState === 'approved' || selectedItem.reviewState === 'released' ? 'bg-emerald-950 text-emerald-300' : 'bg-amber-950 text-amber-300'}`}>{selectedItem.reviewLabel}</span></div>
          {selectedVersion ? <>
            <dl className="mt-5 grid gap-3 sm:grid-cols-2"><Meta label="Exact version ID" value={selectedVersion.id} /><Meta label="Version number" value={selectedVersion.version_number} /><Meta label="Checksum" value={selectedVersion.content_checksum || 'Not recorded'} /><Meta label="Classification" value={selectedVersion.data_classification || 'Not recorded'} /></dl>
            <div className="mt-5"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Exact saved payload</p><pre className="mt-2 max-h-[34rem] overflow-auto whitespace-pre-wrap rounded-xl bg-slate-950 p-4 text-xs leading-5 text-slate-300">{JSON.stringify(selectedVersion.content || {}, null, 2)}</pre></div>
          </> : <p className="mt-5 rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">This artifact root has no saved version. No content has been inferred.</p>}
          <div className="mt-5 flex flex-wrap gap-2"><a className={BUTTON} href={`/sphere/artifacts/${encodeURIComponent(selectedItem.id)}`}>Open canonical artifact</a>
            {editorTarget ? <button type="button" className={BUTTON} disabled={stale} onClick={() => onOpenEditor(selectedItem, editorTarget)}>{writerTarget ? 'Open Production writer to continue' : 'Continue in Content editor'}</button>
              : <p className="basis-full text-xs text-amber-300">{typeCounts.get(selectedItem.contentType) === 1 ? `No compatible exact editor is available for this ${label(selectedItem.contentType)} record, so continuation is withheld.` : `Multiple ${label(selectedItem.contentType)} roots exist. The current editor cannot safely target this root, so no first item is selected.`}</p>}
          </div>
        </>}
      </div>

      <aside aria-labelledby="content-source-readiness" className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
        <h3 id="content-source-readiness" className="font-semibold text-white">Source readiness</h3>
        <p className="mt-2 text-xs leading-5 text-slate-500">These indicators describe available inputs. Missing optional sources do not block unrelated content work.</p>
        <p className="mt-2 text-[11px] leading-4 text-slate-600">Changed since use is shown only when this selected saved version records an exact source version. A browsing choice alone is not provenance.</p>
        <div className="mt-4 space-y-3">{CONTENT_HOME_GROUPS.filter(group => group.artifactTypes.length).flatMap(group => group.artifactTypes.map(type => {
          const recorded = recordedSelections[type]
          const selection = sourceSelections[type] || recorded
          const readiness = contentSourceReadiness(workspace, type, selection)
          const candidates = (workspace.artifacts || []).filter(item => item.artifact_type === type)
          return <div key={type} className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
            <div className="flex items-start justify-between gap-3"><p className="text-xs font-semibold text-slate-300">{label(type)}</p><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${STATUS[readiness.status] || STATUS.missing}`}>{readiness.label}</span></div>
            <p className="mt-2 text-[11px] leading-4 text-slate-500">{readinessEffect(readiness.status)}</p>
            {readiness.status === 'selection_required' && <div className="mt-3"><p className="text-[11px] leading-4 text-amber-300">Choose the intended artifact root; none is selected by default.</p><div className="mt-2 flex flex-wrap gap-2">{candidates.map(candidate => <button type="button" className={BUTTON} key={candidate.id} onClick={() => setSourceSelections(current => ({ ...current, [type]: { artifactId: candidate.id } }))}>{candidate.title || candidate.id}</button>)}</div></div>}
            {recorded && <p className="mt-2 text-[11px] text-slate-500">Recorded used version: {recorded.usedVersionId}</p>}
            {sourceSelections[type]?.artifactId && <button type="button" className="mt-2 text-[11px] font-semibold text-slate-500 underline hover:text-slate-300" onClick={() => setSourceSelections(current => { const next = { ...current }; delete next[type]; return next })}>Clear explicit selection</button>}
            {readiness.artifactId && readiness.versionId && <button type="button" className="mt-2 ml-3 text-[11px] font-semibold text-amber-300 underline hover:text-amber-200" onClick={() => setSelectedItemId(readiness.artifactId)}>View exact source</button>}
            {readiness.status === 'changed_since_use' && <p className="mt-2 text-[11px] text-amber-300">The current version differs from the exact version previously used.</p>}
            {readiness.status === 'invalid_selection' && <p role="alert" className="mt-2 text-[11px] text-red-300">{readiness.reason}</p>}
          </div>
        }))}</div>
      </aside>
    </div>}
  </section>
}

function HomeState({ title, detail, alert = false, action }) {
  return <section role={alert ? 'alert' : 'status'} className="rounded-2xl border border-dashed border-slate-700 px-6 py-16 text-center"><h2 className="font-semibold text-slate-200">{title}</h2><p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">{detail}</p>{action && <button type="button" className={`${BUTTON} mt-4`} onClick={action}>Try again</button>}</section>
}

function Meta({ label: name, value }) {
  return <div className="rounded-xl bg-slate-950/60 p-3"><dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-600">{name}</dt><dd className="mt-1 break-all text-xs text-slate-300">{value || 'Not available'}</dd></div>
}
