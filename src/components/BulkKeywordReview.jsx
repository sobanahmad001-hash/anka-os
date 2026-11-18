import {useEffect,useRef,useState} from 'react'
import {supabase} from '../lib/supabase.js'
import {submitKeywordReview} from '../data/bulkKeywordReview.js'
const running=new Set()

export default function BulkKeywordReview({project,page,items,onClose,onSaved,recoveryKey}){
 const key=recoveryKey
 const [review,setReview]=useState(()=>{
  try{return JSON.parse(sessionStorage.getItem(key))||null}catch{return null}
 })
 const [busy,setBusy]=useState(false),[error,setError]=useState('')
 const flight=useRef(false)
 const active=useRef(true)
 useEffect(()=>{active.current=true;return()=>{active.current=false}},[])
 function save(value){
  sessionStorage.setItem(key,JSON.stringify(value))
  if(active.current)setReview(structuredClone(value))
 }
 function start(action){
  setError('')
  try{save({page:page.id,action,rows:items.map(row=>({query:row.query,revision:row.decision_revision,intent:'',locale:'',status:'ready',request:null}))})}
  catch{setError('Browser recovery storage is unavailable. Enable it before saving decisions.')}
 }
 function edit(index,field,value){
  const next=structuredClone(review);next.rows[index][field]=value
  try{save(next)}catch{setError('Could not save review recovery state.')}
 }
 async function submit(){
  if(flight.current||running.has(key)){setError('This review is still saving. Wait for the current request to finish.');return}
  running.add(key)
  flight.current=true;setBusy(true);setError('')
  try{
   const result=await submitKeywordReview({review:structuredClone(review),scope:{p_org:project.organization_id,p_project:project.id},
    rpc:async(name,args)=>{const {data,error}=await supabase.rpc(name,args);if(error)throw error;return data},save,shouldContinue:()=>active.current})
   if(result.rows.every(row=>row.status==='saved')){sessionStorage.removeItem(key);if(active.current)onSaved()}
  }catch(e){if(active.current)setError(e.message)}finally{running.delete(key);flight.current=false;if(active.current)setBusy(false)}
 }
 function close(){
  if(running.has(key)||review?.rows.some(r=>r.status==='retry'))return
  sessionStorage.removeItem(key);onClose()
 }
 const valid=review?.action!=='selected'||review.rows.every(row=>row.status==='saved'||row.status==='conflict'||row.intent.trim()&&row.locale.trim())
 return <fieldset disabled={busy} className="rounded-lg border border-[var(--anka-line)] p-3 space-y-3">
 <legend>Review selected keywords for {page.title}</legend>
 {error&&<p role="alert">{error}</p>}
 {!review?<><p>{items.length} visible suggestions selected.</p><button type="button" disabled={!items.length} onClick={()=>start('selected')}>Review supporting keyword acceptance</button> <button type="button" disabled={!items.length} onClick={()=>start('dismissed')}>Review dismissal</button></>:<>
 <p>{review.action==='selected'?'Accept as supporting keywords. Confirm intent and locale for every row.':'Dismiss these suggestions.'}</p>
 {review.rows.map((row,index)=><section key={row.query} className="space-y-2"><h4>{row.query}</h4>
 {review.action==='selected'&&<fieldset disabled={!!row.request}><label>Intent for {row.query} <input value={row.intent} maxLength={250} onChange={e=>edit(index,'intent',e.target.value)}/></label> <label>Locale for {row.query} <input value={row.locale} maxLength={60} onChange={e=>edit(index,'locale',e.target.value)}/></label></fieldset>}
 <p role="status">{row.status==='saved'?'Saved':row.status==='conflict'?'Conflict — close this review and reload the table to review this row again.':row.status==='retry'?'Unconfirmed — retry the same request.':'Ready for confirmation'}</p>
 {row.error&&<p role="alert">{row.error}</p>}</section>)}
 <button type="button" disabled={!valid||review.rows.every(row=>['saved','conflict'].includes(row.status))} onClick={submit}>{review.rows.some(row=>row.request)?'Retry unsaved rows':'Confirm selected decisions'}</button>
 </>}
 <button type="button" disabled={review?.rows.some(r=>r.status==='retry')} onClick={close}>Close review</button>
 </fieldset>
}
