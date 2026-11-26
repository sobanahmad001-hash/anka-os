import {useRef,useState} from 'react'
import {consentSuccessor} from '../data/contentVersionConsent.js'

export default function ContentVersionConsent({artifact,version,latestId,projectId,repository,disabled,onSaved}) {
  const [allowed,setAllowed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[attempted,setAttempted]=useState(false)
  const flight=useRef(false)
  const [contextEvidence,setContextEvidence]=useState(null)
  async function verify(){
    if(flight.current||disabled)return
    flight.current=true;setBusy(true);setError('');setContextEvidence(null)
    try {
      const result=await repository.getProjectContext(projectId)
      const exact=result.approved_versions.find(v=>v.artifact_version_id===version.id&&v.artifact_id===artifact.id&&v.content_checksum===version.content_checksum)
      if(result.project_id!==projectId||!exact)throw Error('This exact version is not in approved project AI context. Check consent and approval.')
      setContextEvidence(exact)
    }catch(e){setError(e.message)}finally{setBusy(false);flight.current=false}
  }
  async function save(){
    if(flight.current||disabled||attempted)return
    flight.current=true;setBusy(true);setError('')
    try {
      const input=consentSuccessor(artifact,version,latestId,allowed)
      setAttempted(true)
      const result=await repository.saveArtifact(input)
      if(!result?.version?.id||result.artifact_id!==artifact.id)throw Error('Save outcome needs review. Refresh the library before continuing.')
      await onSaved(result.version.id)
    } catch(e){setError(e.message)} finally{setBusy(false);flight.current=false}
  }
  return <section className="mt-5 rounded-xl border border-slate-700 p-4" aria-label="Exact version AI consent">
    <h3>AI use of this shared version</h3>
    <p>Version {version.version_number} · {version.id} · AI use {version.ai_use_allowed?'allowed':'not allowed'}</p>
    {version.ai_use_allowed&&projectId&&<button type="button" disabled={disabled||busy} onClick={verify}>Verify approved project context</button>}
    {contextEvidence&&<p role="status">Approved project context verified: {contextEvidence.artifact_version_id} · approval {contextEvidence.approval_id} · checksum {contextEvidence.content_checksum}. Private chat and source body are excluded from this context manifest.</p>}
    {!version.ai_use_allowed&&version.content?.schema_version===2&&artifact.artifact_type==='content'&&<>
      <p>Create a new immutable version with identical content and source citations. Review and approve that new version before it can enter approved AI context.</p>
      <label><input type="checkbox" checked={allowed} disabled={disabled||busy||attempted||version.id!==latestId||version.data_classification==='restricted'} onChange={e=>setAllowed(e.target.checked)}/>Allow AI use of the identical successor to this exact version</label>
      <button type="button" disabled={!allowed||disabled||busy||attempted} onClick={save}>Save consented version</button>
      {version.id!==latestId&&<p>Open the latest version before saving consent.</p>}
      {attempted&&<p>Refresh the library to inspect the saved version before another action. This control does not resubmit an uncertain save.</p>}
    </>}
    {error&&<p role="alert">{error}</p>}
  </section>
}
