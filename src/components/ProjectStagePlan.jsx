import {useId, useRef, useState} from 'react'
import './projectStagePlan.css'

const STATUS = {not_started:'Not started',in_progress:'In progress',in_review:'In review',done:'Done',blocked:'Blocked'}
const phaseKeys={branding:['brief','positioning','services','identity'],website:['goals','keywords','sitemap','content','design','build','qa','publish','marketing_ready'],marketing:['goals','opportunities','plan','assets','review','launch','measure','improve']}
const suggestedTracks = [
 {id:'branding',title:'Branding foundation',description:'Shared direction for Website and Marketing.',stages:['Business brief','Brand positioning & statement','Product & service structure','Messaging & visual identity']},
 {id:'website',title:'Website',description:'Each page can move forward independently.',stages:['Goals & audience','Keyword research & search intent','Sitemap & keyword-to-page mapping','Page content','Design','Build','QA','Publish','Ready for marketing']},
 {id:'marketing',title:'Marketing cycles',description:'Plan, deliver and learn in recurring cycles.',stages:['Goals & baseline','Audience & keyword opportunities','Campaign & content plan','Create assets','Review','Launch','Measure','Improve & next cycle']},
].map(track=>({...track,configuration:'unconfigured',stages:track.stages.map((title,index)=>({id:`${track.id}.${phaseKeys[track.id][index]}`,title,configured:false}))}))
const safePath = path => typeof path==='string' && path.startsWith('/') && !path.startsWith('//') && !path.includes('\\') ? path : null
function stateLabel(stage){return stage.configured===false?'Not configured':STATUS[stage.status]||'Status unavailable'}
function Progress({value}){
 if(!value || !Number.isInteger(value.completed)||!Number.isInteger(value.total)||value.total<=0||value.completed<0||value.completed>value.total)return null
 return <span className="stage-plan-progress">{value.completed} of {value.total} {value.label||'required items complete'}</span>
}
function Output({output,onOpen,busy}){
 const path=safePath(output.path)
 return <li>{onOpen&&output.versionId?<button type="button" disabled={busy} onClick={()=>onOpen(output)}>{output.title||'Open recorded output'} <span aria-hidden="true">↗</span></button>:path?<a href={path}>{output.title||'Open recorded output'} <span aria-hidden="true">↗</span></a>:<span>{output.title||'Recorded output'}</span>}{output.versionLabel&&<small>{output.versionLabel}</small>}{!path&&!onOpen&&<small>Open this record from project work.</small>}</li>
}

// Read-only presentation. Status, counts and change impact belong to the canonical projection.
export default function ProjectStagePlan({plan,onContinue,onManualSetup,onOpenWork,onOpenOutput,busy=false}){
 const detailRef=useRef(null)
 const uid=useId(),[trackId,setTrackId]=useState(null),[stageId,setStageId]=useState(null)
 const unavailable=plan?.state==='unavailable'
 const tracks=!unavailable&&plan?.tracks?.length?plan.tracks:suggestedTracks
 const track=tracks.find(row=>row.id===trackId)||tracks[0]
 const stage=track.stages?.find(row=>row.id===stageId)||track.stages?.[0]
 const selectTrack=id=>{setTrackId(id);setStageId(null)}
 const selectStage=id=>{setStageId(id);requestAnimationFrame(()=>{detailRef.current?.focus({preventScroll:true});if(globalThis.matchMedia?.('(max-width:700px)').matches)detailRef.current?.scrollIntoView({block:'start'})})}
 return <section className="stage-plan" aria-label="Project stage plan">
  <header className="stage-plan-intro"><div><p className="stage-plan-eyebrow">One project plan</p><h3>Build the foundation. Move each stream forward.</h3><p>Shared brand direction connects your Website and Marketing work.</p></div>{onManualSetup&&<button type="button" className="workspace-button" disabled={busy} onClick={onManualSetup}>Manual setup</button>}</header>
  {unavailable&&<p role="status" className="stage-plan-notice">Saved progress is unavailable. These stages are guidance; completion has not been verified.</p>}
  {!plan?.tracks?.length&&!unavailable&&<p className="stage-plan-notice">No mapped stage plan yet. Review your services and quantities to configure it. Existing work stays in the project.</p>}
  <nav className="stage-plan-tracks" aria-label="Project plan streams">{tracks.map(row=><button type="button" key={row.id} aria-pressed={track.id===row.id} onClick={()=>selectTrack(row.id)}><strong>{row.title}</strong><span>{row.description}</span>{row.cycleLabel&&<small>{row.cycleLabel}</small>}</button>)}</nav>
  <div className="stage-plan-body">
   <div className="stage-plan-stages"><div className="stage-plan-track-heading"><h4>{track.title}</h4>{track.scopeLabel&&<p>{track.scopeLabel}</p>}</div><ol aria-label={`${track.title} stages`}>{(track.stages||[]).map((row,index)=><li key={row.id}><button type="button" aria-pressed={stage?.id===row.id} aria-controls={`${uid}-detail`} onClick={()=>selectStage(row.id)}><span className={`stage-plan-number status-${row.status||'unknown'}`} aria-hidden="true">{row.status==='done'&&row.configured!==false?'✓':index+1}</span><span className="stage-plan-card-copy"><strong>{row.title}</strong><span className="stage-plan-card-meta"><span>{stateLabel(row)}</span>{row.needsUpdate&&<span className="stage-plan-update">Needs update</span>}</span><Progress value={row.configured===false?null:row.progress}/>{row.scopeLabel&&<small className="stage-plan-scope">{row.scopeLabel}</small>}</span><span aria-hidden="true">›</span></button></li>)}</ol></div>
   {stage?<section ref={detailRef} tabIndex={-1} id={`${uid}-detail`} className="stage-plan-detail" aria-label={`Stage details: ${stage.title}`}>
    <p className="stage-plan-eyebrow">{track.title}</p><h4>{stage.title}</h4><div className="stage-plan-detail-status"><span>{stateLabel(stage)}</span>{stage.needsUpdate&&<span className="stage-plan-update">Needs update</span>}</div>
    {stage.description&&<p>{stage.description}</p>}<Progress value={stage.configured===false?null:stage.progress}/>{stage.scopeLabel&&<p className="stage-plan-scope">{stage.scopeLabel}</p>}
    {stage.configured===false&&<p>This stage is not mapped to saved project work yet. Continue in Chat to plan it, or use manual setup.</p>}
    {stage.blockedReason&&<p className="stage-plan-notice">{stage.blockedReason}</p>}
    {stage.needsUpdate&&<p className="stage-plan-notice">{stage.updateReason||'An upstream input changed. Review the affected work; recorded outputs and history are retained.'}</p>}
    {stage.items?.length>0&&<div className="stage-plan-items"><h5>Work in this stage</h5>{stage.items.map(item=><article key={item.id}><div><strong>{item.title}</strong><span>{stateLabel(item)}</span>{item.needsUpdate&&<span className="stage-plan-update">Needs update</span>}</div>{item.intent&&<p>Search intent: {item.intent}</p>}{item.keywords?.length>0&&<p>Keywords: {item.keywords.join(', ')}</p>}{item.scopeLabel&&<p>{item.scopeLabel}</p>}{onContinue&&<button type="button" disabled={busy} onClick={()=>onContinue({track,stage,item})}>Continue in Chat <span className="sr-only">for {item.title}</span></button>}</article>)}</div>}
    <div className="stage-plan-outputs"><h5>Outputs</h5>{stage.outputs?.length?<ul>{stage.outputs.map(output=><Output key={output.id} output={output} onOpen={onOpenOutput} busy={busy}/>)}</ul>:<p>No recorded outputs for this stage.</p>}</div>
    <div className="stage-plan-actions">{onContinue&&<button type="button" className="stage-plan-continue" disabled={busy} onClick={()=>onContinue({track,stage})}>Continue in Chat <span aria-hidden="true">↗</span></button>}{onOpenWork&&<button type="button" className="workspace-button" disabled={busy} onClick={onOpenWork}>Open project work</button>}</div><p className="stage-plan-footnote">Review the stage context in your message before sending.</p>
   </section>:<p className="stage-plan-notice">No stages are mapped to this stream yet.</p>}
  </div>
 </section>
}
