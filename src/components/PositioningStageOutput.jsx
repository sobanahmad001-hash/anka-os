import {useEffect,useRef,useState} from 'react'
import {supabase} from '../lib/supabase.js'
import {readPositioningStageOutput} from '../data/positioningStageOutput.js'

export default function PositioningStageOutput({scope,signal,phase,busy,onContinue,client=supabase}){
  const {organizationId,projectId,engagementId,actorId}=scope
  const [record,setRecord]=useState(null),[error,setError]=useState(''),[checking,setChecking]=useState(false),[refresh,setRefresh]=useState(0)
  const life=useRef(null),flight=useRef(false),live=useRef(null)
  live.current={record,busy,onContinue}
  useEffect(()=>{
    const controller=new AbortController()
    life.current=controller
    const abort=()=>controller.abort()
    signal?.addEventListener('abort',abort,{once:true})
    if(signal?.aborted)abort()
    setRecord(null);setError('');setChecking(false);flight.current=false
    if(!controller.signal.aborted)readPositioningStageOutput(client,{organizationId,projectId,engagementId,actorId},controller.signal)
      .then(value=>{if(!controller.signal.aborted)setRecord(value)})
      .catch(cause=>{if(!controller.signal.aborted)setError(cause.message)})
    return()=>{abort();signal?.removeEventListener('abort',abort)}
  },[client,organizationId,projectId,engagementId,actorId,signal,refresh])
  const version=record?.current
  async function next(){
    const controller=life.current
    if(!controller||controller.signal.aborted||flight.current||live.current.busy||record!==live.current.record||!version?.conversation_id||version.binding_id!==record.bindingId)return
    flight.current=true;setChecking(true);setError('')
    try{
      const fresh=await readPositioningStageOutput(client,scope,controller.signal)
      if(controller.signal.aborted||live.current.busy)return
      setRecord(fresh)
      if(fresh.bindingId!==record.bindingId||!fresh.current||Object.keys(version).some(key=>fresh.current[key]!==version[key])){
        setError('The positioning version or brief binding changed. Review the current output.');return
      }
      const notice=live.current.onContinue?.(fresh.current)
      if(typeof notice==='string')setError(notice)
    }catch(cause){if(!controller.signal.aborted){setRecord(null);setError(cause.message)}}
    finally{if(!controller.signal.aborted){flight.current=false;setChecking(false)}}
  }
  return <section aria-label="Saved positioning output"><h5>Brand positioning &amp; statement</h5>
    {version?<><p>Saved version {version.version_number} · {version.version_id}</p>
      {version.binding_id!==record.bindingId?<p>The saved version belongs to an earlier brief binding.</p>:phase==='branding.services'&&(version.conversation_id?
        <button type="button" disabled={busy||checking||!onContinue} onClick={next}>Continue with this version in private Chat</button>:
        <p>Continuation is available to the owner in the originating private Chat.</p>)}</>:record?<p>No positioning version has been saved.</p>:!error&&<p role="status">Reading saved positioning output…</p>}
    {error&&<p role="status">{error}</p>}
    <button type="button" disabled={busy||checking} onClick={()=>setRefresh(value=>value+1)}>Refresh positioning output</button>
  </section>
}
