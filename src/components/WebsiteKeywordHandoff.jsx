import { lazy, Suspense, useState } from 'react'
import { websiteAsset } from '../data/projectAssetWork.js'
import { projectPipelineConfigurations } from '../data/projectPipelineConfigurations.js'
import { projectWebsiteSeoObservations } from '../data/projectWebsiteSeoObservations.js'
import { projectWebsitePages } from '../data/projectWebsitePages.js'
import { sameBinding } from '../data/foundationCheckpointRepository.js'
import { readWebsiteBrief } from './WebsiteGoals.jsx'
const PageKeywordAuthoring = lazy(() => import('./PageKeywordAuthoring.jsx'))

export default function WebsiteKeywordHandoff({scope, goals, structure, bindingId, catalogue = projectPipelineConfigurations, pages = projectWebsitePages, verifyStructure, foundation, evidence = projectWebsiteSeoObservations, signal, busy}) {
  const [items, setItems] = useState(null)
  const [versions, setVersions] = useState(null)
  const [version, setVersion] = useState('')
  const [asset, setAsset] = useState(null)
  const [observations, setObservations] = useState(null)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  if (!goals || goals.binding.request_id !== bindingId) return <p>Select goal and audience passages from the current brief in Website Goals &amp; audience.</p>
  async function verifyInputs() {
    const fresh = await readWebsiteBrief(foundation, scope, signal)
    if (!sameBinding(fresh.binding, goals.binding)) throw Error('Review the changed brief in Goals & audience.')
    await verifyStructure()
  }
  async function run(action) {
    setWorking(true); setError('')
    try {
      await verifyInputs()
      await action()
    } catch (cause) { setError(cause.message) } finally { setWorking(false) }
  }
  const find = offset => run(async () => {
    setVersion(''); setItems(null); setAsset(null); setObservations(null); setVersions(null)
    const result = await catalogue.listStageArtifacts(scope.organizationId, scope.engagementId, {offset, signal})
    if (!signal?.aborted) setVersions(result)
  })
  const list = offset => run(async () => {
    setItems(null); setAsset(null); setObservations(null)
    const rows = await pages.list({...scope,architectureVersionId:version,offset,limit:25},{signal})
    if (rows.reference?.artifact_version_id !== version) throw Error('Reopen the exact approved architecture.')
    if (!signal?.aborted) setItems({...rows,offset})
  })
  function choose(row) {
    setAsset(websiteAsset(row,{...scope,architectureVersionId:version},items.reference))
    setObservations(null); setError('')
  }
  const inspect = offset => run(async () => {
    setObservations(null)
    const result = await evidence.list({...scope,pageId:asset.id,architectureVersionId:asset.sourceVersionId,
      category:'query_observations',offset,limit:25},{signal})
    if (!signal?.aborted) setObservations(result)
  })
  return <section aria-label="Page keyword research"><h5>Research inputs</h5>
    <p>Brief v{goals.binding.source_version} · Service structure v{structure.version_number}</p>
    <blockquote>{goals.goal}</blockquote><blockquote>{goals.audience}</blockquote>
    <fieldset disabled={working || busy || editing}>
      <button type="button" onClick={()=>find(0)}>Find approved architectures</button>
      {versions && !versions.artifacts.some(v=>v.artifact_type==='website_architecture') && <p>{versions.has_more || versions.offset ? 'No approved Website architecture on this results page.' : 'Page keyword authoring requires an approved Website architecture and a registered page. This engagement has no approved Website architecture available.'}</p>}
      {versions && <div><label>Approved architecture<select value={version} onChange={e=>{setVersion(e.target.value);setItems(null);setAsset(null);setObservations(null)}}>
        <option value="">Choose a version</option>{versions.artifacts.filter(v=>v.artifact_type==='website_architecture').map(v=><option key={v.artifact_version_id} value={v.artifact_version_id}>{v.title} · v{v.version_number}</option>)}</select></label>
        {versions.offset>0 && <button type="button" onClick={()=>find(versions.offset-25)}>Previous architectures</button>}
        {versions.has_more && <button type="button" onClick={()=>find(versions.offset+25)}>Next architectures</button>}</div>}
      <button type="button" disabled={!version} onClick={()=>list(0)}>Find registered pages</button>
      {items && <div>{!items.pages.some(row=>row.page_id) && <p>No registered pages on this results page.</p>}
        {items.pages.filter(row=>row.page_id).map(row=><button type="button" key={row.page_id} onClick={()=>choose(row)}>{row.source.title || row.source.page_key}</button>)}
        {items.offset>0 && <button type="button" onClick={()=>list(items.offset-25)}>Previous pages</button>}
        {items.offset+25<items.counts.filtered_total && <button type="button" onClick={()=>list(items.offset+25)}>Next pages</button>}</div>}
      {asset && <><p>Selected page: {asset.title}</p><button type="button" onClick={()=>inspect(0)}>Read stored query evidence</button>
        {observations && <><p>Historical query records: {observations.matching}. Records without verified resource provenance have unknown metrics.</p>
          {observations.items.map(row=><p key={row.id}>{row.query} · collected {row.snapshot_date}</p>)}
          {observations.offset>0 && <button type="button" onClick={()=>inspect(observations.offset-25)}>Previous query records</button>}
          {observations.has_more && <button type="button" onClick={()=>inspect(observations.offset+25)}>Next query records</button>}</>}
        <p>Enter proposed terms and search intent in the page strategy. Leave unsupported measurements blank.</p>
        <button type="button" onClick={()=>run(()=>setEditing(true))}>Open keyword strategy for this page</button></>}
    </fieldset>
    {editing && <Suspense fallback={<p>Opening page keyword strategy…</p>}><PageKeywordAuthoring asset={asset} verifyInputs={verifyInputs} actorId={scope.actorId} signal={signal} onClose={()=>setEditing(false)}/></Suspense>}
    {error && <p role="alert">{error}</p>}
  </section>
}
