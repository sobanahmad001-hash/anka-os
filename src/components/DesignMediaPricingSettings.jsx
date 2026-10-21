import DesignEstimatedTestSettings from './DesignEstimatedTestSettings.jsx'
import {usdBoundToMicrousd} from '../data/designMediaPriceInput.js'
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { invokeDesignFunction } from '../data/designWorkshopRequest.js'
const empty=()=>({price_basis:'verified',provider:'higgsfield',model_id:'',settings:'{}',unit_max_charge_usd:'',source_url:'',verified_at:'',valid_until:''})
const inputClass='mt-1 w-full rounded-lg border border-[var(--anka-line)] bg-[var(--anka-surface)] p-2 text-[var(--anka-ink)]'
export default function DesignMediaPricingSettings({organizationId,canManage,requestSignal,client=supabase}) {
 const [form,setForm]=useState(empty),[rates,setRates]=useState([]),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[blocked,setBlocked]=useState(Boolean(requestSignal?.aborted)),[uncertain,setUncertain]=useState(false)
 const pending=useRef(false),generation=useRef(0)
 useEffect(()=>{const abort=()=>{generation.current++;setBlocked(true);setRates([]);setForm(empty());setMessage('Organization access changed. Reopen settings in the current organization.')};setBlocked(Boolean(requestSignal?.aborted));requestSignal?.addEventListener('abort',abort,{once:true});return()=>{generation.current++;requestSignal?.removeEventListener('abort',abort)}},[organizationId,requestSignal])
 if(!canManage||!organizationId)return null
 const change=(key,value)=>{setForm(old=>({...old,[key]:value}));setMessage('')}
 async function read(){
  if(pending.current||blocked)return;pending.current=true;setBusy(true);const current=generation.current
  try{const data=await invokeDesignFunction(client,'design-workshop',organizationId,'list_media_rates',{}, {signal:requestSignal});if(current!==generation.current||requestSignal?.aborted)return;if(!Array.isArray(data)||data.some(row=>row.organization_id!==organizationId))throw Error('Invalid response');setRates(data);setUncertain(false);setMessage('Current reviewed rates loaded.')}
  catch{if(current===generation.current&&!requestSignal?.aborted)setMessage('Rates could not be read. Existing configuration is unchanged by this read.')}
  finally{pending.current=false;if(current===generation.current)setBusy(false)}
 }
 async function save(event){
  event.preventDefault();if(pending.current||blocked||uncertain)return
  let settings;try{settings=JSON.parse(form.settings);if(!settings||typeof settings!=='object'||Array.isArray(settings))throw Error()}catch{setMessage('Enter an exact settings JSON object.');return}
  let unit;try{unit=usdBoundToMicrousd(form.unit_max_charge_usd)}catch(error){setMessage(error.message);return}
  pending.current=true;setBusy(true);setMessage('Saving reviewed rate…');const current=generation.current
  try{const saved=await invokeDesignFunction(client,'design-workshop',organizationId,'configure_media_rate',{price_basis:form.price_basis,provider:form.provider,model_id:form.model_id,source_url:form.source_url,verified_at:form.verified_at,valid_until:form.valid_until,settings,unit_max_charge_microusd:unit},{signal:requestSignal});if(current!==generation.current||requestSignal?.aborted)return;if(!saved?.id||saved.organization_id!==organizationId)throw Error('Unconfirmed save');setRates(rows=>[saved,...rows.filter(row=>row.id!==saved.id)]);setMessage('Reviewed rate saved and confirmed. Existing generated media is unchanged.')}
  catch{if(current===generation.current&&!requestSignal?.aborted){setUncertain(true);setMessage('Save was not confirmed. Refresh rates before making another change. Your draft is preserved.')}}
  finally{pending.current=false;if(current===generation.current)setBusy(false)}
 }
 return <section id="design-media-pricing" aria-label="Design media pricing administration" className="rounded-2xl border border-[var(--anka-line)] bg-[var(--anka-surface)] p-5">
 <h2 className="font-semibold">Design media pricing</h2><p className="mt-2 text-sm text-[var(--anka-muted)]">Administrators record verified maximum prices or clearly labeled reference estimates for exact provider settings. A rate is valid for at most 24 hours. This does not enable a model or send a generation request.</p>
 <button type="button" onClick={read} disabled={busy||blocked} className="mt-3 rounded-lg border border-[var(--anka-line)] px-3 py-2">Refresh rates</button>
 {message&&<p role="status" className="mt-3 text-sm">{message}</p>}
 {!blocked&&<form onSubmit={save} className="mt-4 grid gap-3 md:grid-cols-2"><fieldset disabled={busy||blocked} className="contents">
 <label>Price basis<select className={inputClass} value={form.price_basis} onChange={e=>change('price_basis',e.target.value)}><option value="verified">Verified maximum</option><option value="estimated">Reference estimate — not a charge cap</option></select></label><label>Provider<select className={inputClass} value={form.provider} onChange={e=>change('provider',e.target.value)}><option value="higgsfield">Higgsfield</option><option value="openai">OpenAI</option></select></label>
 <label>Exact model ID<input required className={inputClass} value={form.model_id} onChange={e=>change('model_id',e.target.value)}/></label>
 <label className="md:col-span-2">Exact settings (JSON)<textarea required rows={3} className={inputClass} value={form.settings} onChange={e=>change('settings',e.target.value)}/></label>
 <label>{form.price_basis==='estimated'?'Estimated total price per output (USD)':'Maximum total price per output (USD)'}<input required type="text" inputMode="decimal" className={inputClass} value={form.unit_max_charge_usd} onChange={e=>change('unit_max_charge_usd',e.target.value)}/><small>{form.price_basis==='estimated'?'Enter a documented reference estimate for these exact settings, including duration and inputs. Actual charges can be higher. Never enter an invented price or credit conversion.':'Enter the complete verified USD bound for one output, including billable inputs and duration. Starting prices or unverified credit conversions are insufficient. Quotes multiply this bound by output count.'}</small></label>
 <label>Official pricing source URL<input required type="url" className={inputClass} value={form.source_url} onChange={e=>change('source_url',e.target.value)}/></label>
 <label>{form.price_basis==='estimated'?'Reference reviewed at':'Verified at'} (ISO date and time with timezone)<input required placeholder="2026-10-15T12:00:00Z" className={inputClass} value={form.verified_at} onChange={e=>change('verified_at',e.target.value)}/></label>
 <label>Expires at (ISO date and time with timezone)<input required placeholder="2026-10-15T13:00:00Z" className={inputClass} value={form.valid_until} onChange={e=>change('valid_until',e.target.value)}/></label>
 <button disabled={uncertain} type="submit" className="rounded-lg bg-[var(--anka-violet)] px-3 py-2 text-[var(--anka-on-violet)]">{busy?'Working…':'Save reviewed rate'}</button></fieldset></form>}
 {!blocked&&<ul className="mt-4 space-y-2">{rates.map(rate=><li key={rate.id} className="break-words rounded-lg border border-[var(--anka-line)] p-3 text-sm"><strong>{rate.provider} · {rate.model_id}</strong><p>{rate.price_basis==='estimated'?'Estimated per output (not a cap):':'Maximum per output:'} {(rate.unit_max_charge_microusd/1000000).toFixed(6)} USD · expires {rate.valid_until}</p><code className="whitespace-pre-wrap">{JSON.stringify(rate.settings)}</code></li>)}</ul>}
 <DesignEstimatedTestSettings key={organizationId} organizationId={organizationId} client={client} requestSignal={requestSignal}/>
 </section>
}
