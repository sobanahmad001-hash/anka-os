import {useEffect,useRef,useState} from 'react'
import {freshGeneratedPreview} from '../data/designGeneratedOriginal.js'

export default function DesignGeneratedMediaResult({job,access,organizationId,conversationId=null,signal,onOpenOutput,large=false}) {
 const [media,setMedia]=useState(null),[notice,setNotice]=useState(''),[busy,setBusy]=useState(''),[scopeAborted,setScopeAborted]=useState(Boolean(signal?.aborted))
 const epoch=useRef(0),alive=useRef(false)
 const key=JSON.stringify([organizationId,conversationId,job.id,job.operation_key,job.request?.creative_brief_version_id])
 useEffect(()=>{alive.current=true;const turn=++epoch.current;setScopeAborted(Boolean(signal?.aborted));setMedia(null);setNotice('');setBusy('');const stop=()=>{epoch.current++;setScopeAborted(true);setMedia(null);setBusy('')};signal?.addEventListener('abort',stop,{once:true})
  if(job.status==='ready'&&!signal?.aborted){const fresh=freshGeneratedPreview(job,{organizationId,conversationId});if(fresh)setMedia(fresh);else access.read(job,{conversationId}).then(result=>{if(alive.current&&epoch.current===turn&&!signal?.aborted)setMedia(result)}).catch(()=>{if(alive.current&&epoch.current===turn&&!signal?.aborted)setNotice('Original preview unavailable. Refresh to check current access.')})}
  return()=>{alive.current=false;epoch.current++;signal?.removeEventListener('abort',stop)}
 },[key,job,access,organizationId,conversationId,signal])
 const current=turn=>alive.current&&epoch.current===turn&&!signal?.aborted
 async function read(download=false,outputId=null){if(busy||signal?.aborted)return;const turn=epoch.current;setBusy(download?outputId:'preview');setNotice('');try{
  const result=await access.read(job,{conversationId,download});if(!current(turn))return
  if(download){const output=result.outputs.find(row=>row.id===outputId);if(!output)throw Error('Original output unavailable');const a=document.createElement('a');a.href=output.download_url;a.download=output.filename;a.rel='noopener';document.body.appendChild(a);a.click();a.remove()}
  else setMedia(result)
 }catch{if(current(turn)){setMedia(null);setNotice('Original file or permission changed. Refresh to check access; generation will not be repeated.')}}finally{if(current(turn))setBusy('')}}
 if(scopeAborted||signal?.aborted)return null
 const outputs=media?.outputs||job.outputs||[],ready=job.status==='ready'
 return <article className={`design-generated-result${large?' large':''}`} aria-label="Generated media result" data-operation-key={job.operation_key} data-brief-version-id={job.request?.creative_brief_version_id}>
  <header><h3>Generated {ready?(outputs[0]?.mime_type?.startsWith('video/')?'video':'image'):'media request'}</h3><small>{job.brief_version_number?`Brief v${job.brief_version_number} · `:''}{new Date(job.created_at).toLocaleString()}</small></header>
  {!ready&&<p role="status">{job.status==='provider_failed'||job.status==='safety_refused'?'This request did not produce a ready original.':job.status==='outcome_unknown'?'Original request outcome is uncertain. Use its existing request controls to recover; do not generate again.':'Original request is processing. Request controls remain separate from chat.'}</p>}
  {ready&&outputs.map((output,index)=><figure key={output.id} data-output-id={output.id}>{media?.outputs[index]?.signed_url?(output.mime_type.startsWith('image/')?<img loading="lazy" src={media.outputs[index].signed_url} alt={`Generated original ${index+1}`} onError={()=>{setMedia(null);setNotice('Preview expired or unavailable. Refresh preview to check current access.')}}/>:<video controls playsInline preload="metadata" src={media.outputs[index].signed_url} onError={()=>{setMedia(null);setNotice('Preview expired or unavailable. Refresh preview to check current access.')}}/>):<p>Original {index+1} · preview not loaded</p>}<figcaption>{output.mime_type.startsWith('image/')?'Image':'Video'} {index+1} · {output.filename||'retained original'} · {output.mime_type}</figcaption><button type="button" disabled={Boolean(busy)} onClick={()=>read(true,output.id)}>{busy===output.id?'Preparing original…':'Download original'}</button></figure>)}
  {notice&&<p role="status">{notice}</p>}
  {ready&&<div className="design-generated-actions"><button type="button" disabled={Boolean(busy)} onClick={()=>read(false)}>Refresh preview</button>{onOpenOutput&&<button type="button" onClick={()=>onOpenOutput(job)}>Open larger in Output</button>}</div>}
 </article>
}
