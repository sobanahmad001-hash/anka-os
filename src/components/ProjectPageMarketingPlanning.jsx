import {useEffect,useRef,useState} from 'react'
import {supabase} from '../lib/supabase.js'
import {createProjectMarketingPagePlanning} from '../data/projectMarketingPagePlanning.js'
import {validateCampaignBriefDraft} from '../data/marketingStudio.js'

export default function ProjectPageMarketingPlanning(props){
 const request=useRef({signal:props.signal,revision:0})
 if(request.current.signal!==props.signal)request.current={signal:props.signal,revision:request.current.revision+1}
 const {asset,actorId,brandId}=props
 if(asset?.kind!=='website_page'||!actorId||!brandId)return <p role="status">Choose an authorized registered page to plan Marketing.</p>
 return <Planning key={[actorId,brandId,asset.organizationId,asset.projectId,asset.engagementId,asset.id,asset.sourceVersionId,request.current.revision].join(':')} {...props}/>
}

// eslint-disable-next-line no-unused-vars -- JSX consumer above.
function Planning({asset,actorId,brandId,signal,disabled=false,onLockChange,onClose,client=supabase}){
 const [api]=useState(()=>createProjectMarketingPagePlanning(client))
 const [review,setReview]=useState(null),[confirmed,setConfirmed]=useState(false),[goal,setGoal]=useState(''),[channels,setChannels]=useState(''),[audience,setAudience]=useState(''),[draft,setDraft]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const alive=useRef(true),flight=useRef(false),current=useRef(null),callbacks=useRef(null)
 current.current={disabled,signal,review,confirmed,goal,channels,audience};callbacks.current={onLockChange,onClose}
 const dirty=Boolean(goal||channels||audience),locked=busy||dirty
 const {organizationId,projectId,engagementId,id:pageId,sourceVersionId:architectureVersionId}=asset
 useEffect(()=>{
  api.select({actorId,brandId,organizationId,projectId,engagementId,pageId,architectureVersionId})
  alive.current=true
  return ()=>{alive.current=false;api.select(null)}
 },[api,actorId,brandId,organizationId,projectId,engagementId,pageId,architectureVersionId])
 useEffect(()=>{callbacks.current.onLockChange?.(locked);return()=>callbacks.current.onLockChange?.(false)},[locked])
 const active=()=>alive.current&&!current.current.signal?.aborted&&!current.current.disabled
 async function run(fn){if(!active()||flight.current)return;flight.current=true;setBusy(true);setError('');try{await fn()}catch(e){if(active()){setError(e.message);setDraft(null);setConfirmed(false)}}finally{flight.current=false;if(alive.current)setBusy(false)}}
 function change(setter,value){if(!active()||flight.current)return;setter(value);setDraft(null)}
 async function load(){setDraft(null);setReview(null);setConfirmed(false);const value=await api.review({signal});if(active())setReview(value)}
 async function prepare(){const v=current.current;if(!v.confirmed||!v.review)return;const content=validateCampaignBriefDraft({campaign_goal:v.goal,channels:v.channels,audience:v.audience});const seed=await api.preparePlanningSeed(v.review,{confirmed:true,signal});if(active())setDraft({seed,content})}
 function discard(){if(!active()||flight.current)return;setGoal('');setChannels('');setAudience('');setDraft(null);setConfirmed(false);setReview(null);setError('')}
 return <section className="rounded-lg border border-[var(--anka-line)] p-3 space-y-3" aria-label="Page Marketing planning">
  <header><h4>Marketing planning · {asset.title}</h4><p>Review this page’s saved targets and evidence before drafting a plan. Campaign execution and publication are separate.</p></header>
  {error&&<p role="alert">{error}</p>}
  <button type="button" className="workspace-button" disabled={disabled||busy} onClick={()=>run(load)}>Review page for Marketing</button>
  {review&&<section aria-label="Reviewed Marketing page sources">
   <p>Page {review.page.page_key} · {review.page.planned_path||'Path unavailable'}</p>
   <details><summary>Exact page and source attribution</summary><p>Page {review.page.id}</p><p>Architecture {review.page.architecture_version_id}</p><p>Targeting revision {review.targeting.revision} · strategy {review.targeting.strategy_version_id||'None recorded'} · checksum {review.targeting.source_checksum||'None recorded'}</p></details>
   <h5>Planned keyword targets</h5>{review.targeting.targets.length?<ul>{review.targeting.targets.map(t=><li key={t.keyword_index}>{t.term} · {t.role} · {t.cluster} · {t.locale||'Locale unknown'} · {t.evidence_source||'Research source unknown'} · {t.observation_date||'Observation date unknown'}</li>)}</ul>:<p>No saved targets. This does not establish search performance.</p>}
   <h5>Recorded evidence</h5>{review.evidence.map(group=><div key={group.category}><p>{group.category==='page_audits'?'Page audits':'Query observations'}: {group.items.length} loaded of {group.matching} matching{group.has_more?' · more records available':''}</p><ul>{group.items.map(row=><li key={row.id}>{row.source_type||row.record_kind||'Source unknown'} · {row.observed_on||'Date unknown'} · version binding unknown · indexed {row.indexed===null?'unknown':String(row.indexed)} · schema {row.schema_valid===null?'unknown':String(row.schema_valid)}</li>)}</ul></div>)}
   <p>Provider metrics and reporting period are unknown. Historical checks are not evidence of this exact version’s performance.</p>
   <fieldset disabled={disabled||busy} className="space-y-2">
    <label className="block">Campaign goal<textarea className="w-full rounded-lg border border-[var(--anka-line)] bg-[var(--anka-surface)] p-2" aria-label="Page Marketing campaign goal" maxLength={4000} value={goal} onChange={e=>change(setGoal,e.target.value)}/></label>
    <label className="block">Channels · one per line<textarea className="w-full rounded-lg border border-[var(--anka-line)] bg-[var(--anka-surface)] p-2" aria-label="Page Marketing channels" maxLength={2000} value={channels} onChange={e=>change(setChannels,e.target.value)}/></label>
    <label className="block">Audience<textarea className="w-full rounded-lg border border-[var(--anka-line)] bg-[var(--anka-surface)] p-2" aria-label="Page Marketing audience" maxLength={4000} value={audience} onChange={e=>change(setAudience,e.target.value)}/></label>
    <label className="block"><input aria-label="Confirm page Marketing source review" type="checkbox" checked={confirmed} onChange={e=>change(setConfirmed,e.target.checked)}/>I reviewed this exact page’s targets and evidence.</label>
    <button type="button" className="workspace-button" disabled={!confirmed||!goal.trim()||!channels.trim()} onClick={()=>run(prepare)}>Prepare Marketing planning draft</button>
   </fieldset>
  </section>}
  {draft&&<section aria-label="Local Marketing planning draft" role="status"><h5>Marketing planning draft · not saved</h5><p>Goal: {draft.content.campaign_goal}</p><p>Channels: {draft.content.channels.join(', ')}</p>{draft.content.audience&&<p>Audience: {draft.content.audience}</p>}<p>Source: page {draft.seed.source_review.page.page_key}, targeting revision {draft.seed.source_review.targeting.revision}.</p><p>Measurement benchmark: unknown. No campaign was created or executed. Saving an official brief requires choosing an existing campaign in Marketing and its normal review controls.</p></section>}
  {dirty&&<button type="button" className="workspace-button" disabled={disabled||busy} onClick={discard}>Discard local Marketing draft</button>}
  <button type="button" className="workspace-button" disabled={disabled||locked} onClick={()=>{if(active()&&!flight.current&&!dirty)callbacks.current.onClose?.()}}>Close Marketing planning</button>
 </section>
}
