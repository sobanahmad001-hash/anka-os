import {useEffect,useRef,useState} from 'react'
import {departmentChat} from '../data/departmentChatRepository.js'
const types={mp4:'video/mp4',mov:'video/quicktime'},maxBytes=20*1024*1024
const sha=async blob=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('')
export default function DesignVideoReferencePanel({uploadOpen=true,conversationKey,conversationId,requestScope,busy,ensureConversation,run}){
 const [rows,setRows]=useState([]),[file,setFile]=useState(null),[classification,setClassification]=useState('internal'),[notice,setNotice]=useState(''),[error,setError]=useState(''),[working,setWorking]=useState(false),[preview,setPreview]=useState(null)
 const attempt=useRef(null),revision=useRef(0),flight=useRef(false),fileInput=useRef(null),previewUrl=useRef(null)
 const locked=busy||working,mime=file?types[file.name.split('.').pop().toLowerCase()]:''
 useEffect(()=>{
  const marker=revision,token=++marker.current;attempt.current=null;setRows([]);setFile(null);setPreview(null);setNotice('');setError('');setWorking(false)
  if(previewUrl.current){URL.revokeObjectURL(previewUrl.current);previewUrl.current=null}
  if(conversationId)departmentChat.listDesignVideoReferences({conversation_id:conversationId},requestScope).then(value=>{if(token===revision.current&&!requestScope.signal?.aborted)setRows(value)}).catch(reason=>{if(token===revision.current&&!requestScope.signal?.aborted)setError(reason.message)})
  return()=>{marker.current++;if(previewUrl.current){URL.revokeObjectURL(previewUrl.current);previewUrl.current=null}}
 },[conversationKey,conversationId,requestScope])
 async function execute(action){
  if(locked||flight.current||requestScope.signal?.aborted)return
  const token=revision.current,current=()=>token===revision.current&&!requestScope.signal?.aborted
  flight.current=true;setWorking(true);setError('');setNotice('')
  try{await run(async()=>{if(current())await action(current)})}catch(reason){if(current())setError(reason.message||'Video reference unavailable. Your original is retained.')}
  finally{flight.current=false;if(current())setWorking(false)}
 }
 async function upload(){
  if(!file||!mime||!conversationId)return
  await execute(async current=>{
   if(!attempt.current){
    if(!file.size||file.size>maxBytes)throw Error('Choose an MP4/MOV original up to 20 MiB.')
    const checksum=await sha(file);if(!current())return
    const previous=rows.find(row=>row.status==='reserved'&&row.expected_sha256===checksum&&row.original_name===file.name&&row.declared_bytes===file.size&&row.claimed_mime===mime&&row.classification===classification&&row.ai_use_allowed===false)
    attempt.current={attachment_id:previous?.id||crypto.randomUUID(),original_name:file.name,claimed_mime:mime,byte_size:file.size,sha256_hex:checksum,classification,ai_use_allowed:false,file}
   }
   const input=attempt.current,conversation=await ensureConversation();if(!current())return
   if(conversation?.id!==conversationId)throw Error('Design conversation changed. Reopen its references.')
   try{
    const saved=await departmentChat.uploadDesignVideoReference({...input,conversation_id:conversationId},requestScope);if(!current())return
    if(saved?.id!==input.attachment_id||saved.status!=='ready'||saved.expected_sha256!==input.sha256_hex)throw Error('Video upload readback could not be verified.')
    const latest=await departmentChat.listDesignVideoReferences({conversation_id:conversationId},requestScope);if(!current())return
    setRows(latest);attempt.current=null;setFile(null);if(fileInput.current)fileInput.current.value=''
    setNotice(`${saved.original_name} saved privately. It is never sent to AI.`)
   }catch(reason){throw Error(reason.message+' Retry the same video upload to recover its original request.')}
  })
 }
 async function remove(row){await execute(async current=>{
  await departmentChat.revokeDesignVideoReference({conversation_id:conversationId,attachment_id:row.id},requestScope);if(!current())return
  if(preview?.id===row.id){if(previewUrl.current)URL.revokeObjectURL(previewUrl.current);previewUrl.current=null;setPreview(null)}
  setRows(old=>old.map(item=>item.id===row.id?{...item,status:'revoked'}:item));setNotice('Video reference removed. Its immutable original is retained; it cannot be selected for AI.')
 })}
 async function readOriginal(row,current){
  const result=await departmentChat.downloadDesignVideoReference({conversation_id:conversationId,attachment_id:row.id},requestScope),blob=result instanceof Response?await result.blob():result
  if(!current())return null
  if(!(blob instanceof Blob)||!blob.size||blob.size>maxBytes||blob.size!==row.declared_bytes||blob.type.split(';')[0]!==row.verified_mime||await sha(blob)!==row.expected_sha256)throw Error('Original video readback does not match its retained checksum.')
  return current()?blob:null
 }
 async function openOriginal(row,download){await execute(async current=>{
  const blob=await readOriginal(row,current);if(!blob||!current())return
  const url=URL.createObjectURL(blob)
  if(download){try{const link=document.createElement('a');link.href=url;link.download=row.original_name;link.click()}finally{setTimeout(()=>URL.revokeObjectURL(url),1000)}}
  else{if(previewUrl.current)URL.revokeObjectURL(previewUrl.current);previewUrl.current=url;setPreview({id:row.id,name:row.original_name,url})}
 })}
 return <section className="design-private-attachments" aria-label="Private video references">
  <div hidden={!uploadOpen}><h4>Video references</h4><p>MP4 or MOV, up to 20 MiB. Originals stay private to you, including in project chats. No AI transfer, transcription, frame extraction, animation or video editing. Preview playback depends on your browser’s codecs; the original is always retained.</p>
  {!conversationId&&<p>Choose an existing saved Design conversation before uploading a video.</p>}
  <label>Video reference<input ref={fileInput} type="file" accept=".mp4,.mov" disabled={locked||!conversationId} onChange={e=>{setFile(e.target.files?.[0]||null);attempt.current=null;setError('')}}/></label>
  <label>Video classification<select value={classification} disabled={locked||Boolean(attempt.current)} onChange={e=>setClassification(e.target.value)}><option value="public">Public</option><option value="internal">Internal</option><option value="confidential">Confidential</option></select></label><p>Classification does not share the original with teammates.</p>
  <button type="button" disabled={locked||!conversationId||!file||!mime} onClick={upload}>{attempt.current?'Retry same video upload':'Upload private video reference'}</button>
  </div>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}{working&&<p role="status">Working with your video reference…</p>}
  <ul>{rows.filter(row=>row.status!=='revoked').map(row=><li key={row.id}><strong>{row.original_name}</strong><span>{row.status==='ready'?'Private reference only; never sent to AI.':'Upload unfinished: choose the same file to recover.'}</span>{row.status==='ready'&&<><button type="button" disabled={locked} onClick={()=>openOriginal(row,false)}>Preview video</button><button type="button" disabled={locked} onClick={()=>openOriginal(row,true)}>Download original video</button></>}<button type="button" disabled={locked} onClick={()=>remove(row)}>Remove video reference</button></li>)}</ul>
  {preview&&<figure><video aria-label="Private video reference preview" controls preload="metadata" style={{maxWidth:'100%'}} src={preview.url} onError={()=>setNotice('This browser cannot play this original. Use Download original video; no conversion was performed.')}/><figcaption>{preview.name} — owner-private original; reference only</figcaption></figure>}
 </section>
}
