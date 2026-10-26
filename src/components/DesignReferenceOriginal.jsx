import {validatedReferenceOriginal} from '../data/designReferenceOriginal.js'
import {useEffect,useRef,useState} from 'react'
export default function DesignReferenceOriginal({row,read,run,busy,signal}){
 const [preview,setPreview]=useState(null),[expanded,setExpanded]=useState(false),[error,setError]=useState(''),url=useRef(null),generation=useRef(0),dialog=useRef(null)
 const mime=row.verified_mime||row.claimed_mime
 useEffect(()=>{const token=generation;token.current++;setPreview(null);setExpanded(false);setError('');return()=>{token.current++;if(url.current){URL.revokeObjectURL(url.current);url.current=null}}},[row.id,row.expected_sha256,row.sha256_hex,signal])
 useEffect(()=>{if(expanded)dialog.current?.showModal?.();else dialog.current?.close?.()},[expanded])
 async function open(download){
  if(busy||signal?.aborted)return
  const token=generation.current;setError('')
  try{await run(async()=>{
   const blob=await validatedReferenceOriginal(await read(),row)
   if(token!==generation.current||signal?.aborted)return
   const next=URL.createObjectURL(blob)
   if(download){try{const link=document.createElement('a');link.href=next;link.download=row.original_name;link.click()}finally{setTimeout(()=>URL.revokeObjectURL(next),1000)}}
   else{if(url.current)URL.revokeObjectURL(url.current);url.current=next;setPreview(next);setExpanded(true)}
  })}catch(reason){if(token===generation.current&&!signal?.aborted)setError(reason.message||'Original is unavailable.')}
 }
 return <div className="design-reference-original">{['image/png','image/jpeg'].includes(mime)&&<button type="button" disabled={busy} onClick={()=>open(false)}>Preview image</button>}<button type="button" disabled={busy} onClick={()=>open(true)}>Download original</button>{error&&<p role="alert">{error}</p>}{preview&&<><img className="design-reference-thumbnail" src={preview} alt={`${row.original_name} thumbnail`}/><dialog ref={dialog} className="design-reference-preview" onCancel={event=>{event.preventDefault();setExpanded(false)}}><figure><img src={preview} alt={row.original_name}/><figcaption>Retained original · pixels are not sent on Send</figcaption></figure><button type="button" onClick={()=>setExpanded(false)}>Close image preview</button></dialog></>}</div>
}
