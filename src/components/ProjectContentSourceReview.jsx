import {useRef,useState} from 'react'
import {projectContentSourceOptions,reviewProjectContentSources} from '../data/projectContentSources.js'
export default function ProjectContentSourceReview({messages,scope,busy,onReviewed}){
 const [selection,setSelection]=useState({requestId:'',briefId:'',draftId:''}),[review,setReview]=useState(null),[confirmed,setConfirmed]=useState(false),[error,setError]=useState('')
 const latest=useRef(null);latest.current={messages,scope,busy,review,selection,confirmed}
 const options=projectContentSourceOptions(messages,scope)
 const change=(key,value)=>{if(latest.current.busy)return;setSelection(s=>({...s,[key]:value}));setReview(null);setConfirmed(false);setError('')}
 const label=m=>`${m.role==='user'?'You':'Anka AI'} · ${m.sequence!=null?'message '+m.sequence+' · ':''}${m.created_at?new Date(m.created_at).toLocaleString():'time unavailable'} · ${m.body.slice(0,80)}`
 const prepare=()=>{if(latest.current.busy)return;try{setReview(reviewProjectContentSources(latest.current.messages,latest.current.selection,latest.current.scope));setConfirmed(false);setError('')}catch(e){setError(e.message)}}
 const apply=()=>{const now=latest.current;if(now.busy||!now.confirmed||now.review!==review)return;try{const exact=reviewProjectContentSources(now.messages,now.selection,now.scope);if(exact.key!==review.key)throw Error('Selected messages changed. Review the current exact sources again.');onReviewed(exact)}catch(e){setReview(null);setConfirmed(false);setError(e.message)}}
 return <section aria-label="Save Chat sources to Content work" className="project-content-source-review">
  <h3>Save Chat sources to Content work</h3><p>Choose the saved messages you reviewed. Message order does not select or approve a brief. Referenced websites have not been verified by this transfer.</p>
  {[['requestId','Your saved request or confirmation',options.filter(m=>m.role==='user')],['briefId','Reviewed brief message',options],['draftId','Exact draft response',options.filter(m=>m.role==='assistant')]].map(([key,title,rows])=><label key={key}>{title}<select className="workspace-input" value={selection[key]} disabled={busy} onChange={e=>change(key,e.target.value)}><option value="">Choose a saved message</option>{rows.map(m=><option key={m.id} value={m.id}>{label(m)}</option>)}</select></label>)}
  <button type="button" className="workspace-button" disabled={busy||Object.values(selection).some(v=>!v)} onClick={prepare}>Review selected brief and draft</button>
  {review&&<section aria-label="Selected Chat source review">{[['Request',review.request],['Brief',review.brief],['Draft',review.draft]].map(([title,m])=><details key={title} open><summary>{title} · {m.id} · {m.body.length} characters</summary><pre>{m.body}</pre></details>)}<label><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/>I reviewed these exact messages for this Content work. This does not approve the output.</label><button type="button" className="workspace-button" disabled={busy||!confirmed} onClick={apply}>Use selected sources for Content work</button></section>}
  {error&&<p role="alert">{error}</p>}
 </section>
}
