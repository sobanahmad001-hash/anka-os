import {useState,useRef,useEffect} from 'react'
import {supabase} from '../lib/supabase.js'
import {createFoundationCheckpointRepository,sameBinding,sameCheckpoint} from '../data/foundationCheckpointRepository.js'

const standard=createFoundationCheckpointRepository(supabase)
export default function FoundationCheckpointPanel({scope,phase,signal,busy,canManage,onContinue,repository=standard}){
 const key=JSON.stringify(['foundation-checkpoint',scope.organizationId,scope.projectId,scope.engagementId,scope.actorId])
 const [row,setRow]=useState(null),[choice,setChoice]=useState(''),[offset,setOffset]=useState(0)
 const [message,setMessage]=useState(''),[working,setWorking]=useState(false)
 const [pending,setPending]=useState(()=>{try{return JSON.parse(sessionStorage.getItem(key))}catch{return null}})
 const mounted=useRef(false),life=useRef(0),flight=useRef(false),live=useRef(null)
 live.current={busy,choice,row,pending,canManage}
 useEffect(()=>{mounted.current=true;const token=++life.current;return()=>{mounted.current=false;life.current=token+1}},[])
 const positioning=phase==='branding.positioning'
 async function run(action){
  if(!mounted.current||flight.current||live.current.busy||signal?.aborted)return
  const token=life.current
  const current=()=>token===life.current&&!signal?.aborted&&!live.current.busy
  flight.current=true;setWorking(true);setMessage('')
  try{await action(current)}catch(e){if(current())setMessage(e.message)}finally{flight.current=false;if(token===life.current)setWorking(false)}
 }
 function clearPending(){sessionStorage.removeItem(key);setPending(null);live.current.pending=null}
 async function recover(current,attempt){
  const original=await repository.recover(scope,attempt,signal)
  if(!current())return
  const fresh=await repository.read(scope,null,0,signal)
  if(!current())return
  setRow(fresh);setChoice('');setOffset(0)
  if(original){clearPending();setMessage(sameBinding(fresh.current_binding,original)?'Original checkpoint binding confirmed.':'Original checkpoint binding confirmed. The current binding has changed since that request.')}
  else setMessage('The original binding is unconfirmed. Check again to read its current state.')
 }
 async function load(current,nextOffset){
  const fresh=await repository.read(scope,null,nextOffset,signal)
  if(current()){setRow(fresh);setChoice('');setOffset(nextOffset)}
 }
 async function inspect(current){
  if(!choice||choice!==live.current.choice||row!==live.current.row)return
  const fresh=await repository.read(scope,choice,offset,signal)
  if(!current())return
  const version=row.options.find(option=>option.checkpoint_id===choice)?.source_version
  if(fresh.selected.source_version!==version){setRow(null);setChoice('');throw Error('Checkpoint version changed. Reload the choices.')}
  setRow(fresh)
 }
 async function bind(current){
  if(!live.current.canManage||live.current.pending||row!==live.current.row||!row.selected?.matches_current_brief||row.selected.checkpoint_id!==live.current.choice)return
  const {checkpoint_id,source_version,brief_sha256}=row.selected
  const attempt={request_id:crypto.randomUUID(),checkpoint_id,source_version,brief_sha256,expected:row.current_binding?.request_id??null}
  sessionStorage.setItem(key,JSON.stringify(attempt));setPending(attempt);live.current.pending=attempt
  try{await repository.bind(scope,attempt,signal)}
  catch(e){
   if(!current())return
   // A PostgreSQL rejection rolls back this command. Other errors may follow a committed write.
   if(['40001','42501','22023'].includes(e.code)){clearPending();setRow(null);setChoice('');await load(current,0);throw e}
   await recover(current,attempt);return
  }
  if(current())await recover(current,attempt)
 }
 async function continuePositioning(current){
  if(live.current.pending||row!==live.current.row||!row?.current_binding||!onContinue)return
  const binding=row.current_binding
  const fresh=await repository.read(scope,binding.checkpoint_id,0,signal)
  if(!current())return
  if(!sameBinding(fresh.current_binding,binding)||!sameCheckpoint(fresh.selected,binding)||!fresh.selected.matches_current_brief){
   setRow(null);throw Error('The bound checkpoint or business brief changed. Review the checkpoint in Business brief.')
  }
  onContinue(binding)
 }
 const disabled=Boolean(busy||working)
 return <fieldset disabled={disabled} className="space-y-2"><legend>Internal brief checkpoint</legend>
  {pending?<button type="button" onClick={()=>run(current=>recover(current,pending))}>Check original checkpoint binding</button>:<>
   <button type="button" onClick={()=>run(current=>load(current,0))}>{positioning?'Check bound brief':'Browse internal checkpoints'}</button>
   {row&&<p>{row.current_binding?'Bound checkpoint '+row.current_binding.checkpoint_id+' · version '+row.current_binding.source_version:'No checkpoint is bound to this foundation.'}</p>}
   {positioning&&row?.current_binding&&onContinue&&<button type="button" onClick={()=>run(continuePositioning)}>Continue in Chat for Brand positioning &amp; statement</button>}
   {!positioning&&row&&<>
    <label>Internal checkpoint<select value={choice} onChange={e=>{setChoice(e.target.value);setRow({...row,selected:null})}}><option value="">Choose a checkpoint</option>{row.options.map(o=><option value={o.checkpoint_id} key={o.checkpoint_id}>{o.checkpoint_id} · version {o.source_version}</option>)}</select></label>
    {offset>0&&<button type="button" onClick={()=>run(current=>load(current,0))}>First checkpoints</button>}
    {row.has_more&&<button type="button" onClick={()=>run(current=>load(current,offset+row.options.length))}>Next checkpoints</button>}
    {choice&&<button type="button" onClick={()=>run(inspect)}>Review selected checkpoint</button>}
    {row.selected&&<section><h5>Reviewed checkpoint · version {row.selected.source_version}</h5><p className="whitespace-pre-wrap">{row.selected.brief_text}</p>
     {row.selected.matches_current_brief?(canManage&&!sameCheckpoint(row.current_binding,row.selected)&&<button type="button" onClick={()=>run(bind)}>Bind reviewed checkpoint to Business brief</button>):<p>The checkpoint differs from the current business brief.</p>}
    </section>}
   </>}
  </>}
  {working&&<p role="status">Checking the project checkpoint…</p>}{message&&<p role="status">{message}</p>}
 </fieldset>
}
