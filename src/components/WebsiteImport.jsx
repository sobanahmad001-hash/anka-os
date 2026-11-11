import {useEffect,useState} from 'react'
import {useAuth} from '../context/AuthContext.jsx'
import {supabase} from '../lib/supabase.js'
import {IMPORT_LIMITS,parseImportCsv,parseImportXlsx} from '../data/projectSpreadsheetSource.js'
import {approvedRows,importPreview,sheetKeywords} from '../data/websiteImport.js'

const btn='workspace-button',field='rounded border border-[var(--anka-line)] bg-[var(--anka-surface)] p-2'
export function WebsiteImportSource({project,pageId}){
 const [source,setSource]=useState(null)
 useEffect(()=>{let active=true;supabase.rpc('read_website_import_source',{p_org:project.organization_id,p_project:project.id,p_page:pageId}).then(({data})=>{if(active)setSource(data)});return()=>{active=false}},[project.id,project.organization_id,pageId])
 if(!source)return null
 return <section><h4>Last imported metadata</h4><p>{source.meta.url} · HTTP {source.meta.status}{source.wpId?' · WordPress #'+source.wpId:''}</p><p>Title: {source.meta.title||'Missing'} · H1: {source.meta.h1||'Missing'}</p><p>Description: {source.meta.description||'Missing'}</p><p>Canonical: {source.meta.canonical||'Not declared'}</p></section>
}
export default function WebsiteImport({project,onApplied,onClose}){
 const {user}=useAuth(),scope={p_org:project.organization_id,p_project:project.id}
 const key=['anka.website-import',user?.id,project.organization_id,project.id].join(':')
 const [pending,setPending]=useState(()=>sessionStorage.getItem(key)),[domain,setDomain]=useState(''),[sheet,setSheet]=useState(null),[which,selectSheet]=useState(0)
 const [preview,setPreview]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('')
 async function file(input){
  setError('');setPreview(null);setSheet(null);selectSheet(0)
  if(!input)return
  setBusy(true)
  try{
   if(input.size>IMPORT_LIMITS.bytes)throw Error('Choose a spreadsheet of up to 2 MB.')
   const bytes=new Uint8Array(await input.arrayBuffer())
   const workbook=/\.xlsx$/i.test(input.name)?parseImportXlsx(bytes):parseImportCsv(bytes)
   const sheets=workbook.sheets.filter(s=>!s.hidden)
   if(!sheets.length)throw Error('The workbook has no visible sheets.')
   setSheet(sheets)
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 async function discover(){
  setBusy(true);setError('');setNotice('');setPreview(null)
  try{
   const terms=sheet?sheetKeywords(sheet[which]):[]
   const {data:discovery,error:failure}=await supabase.functions.invoke('website-discovery',{body:{domain,organization:scope.p_org,project:scope.p_project}})
   if(failure)throw Error('The site could not be read. Check the domain, public HTTPS availability and your Website management access.')
   const {data,error:e}=await supabase.rpc('website_import_context',scope);if(e)throw e
   const result=importPreview(discovery,data.pages,data.sources,terms)
   setPreview({...result,notices:discovery.notices,origin:discovery.origin})
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 function change(i,patch){setPreview(v=>({...v,candidates:v.candidates.map((c,j)=>i===j?{...c,...patch}:c)}))}
 async function apply(){
  const rows=approvedRows(preview.candidates);if(!rows.length||busy||pending)return
  const id=crypto.randomUUID();setBusy(true);setError('')
  try{
   sessionStorage.setItem(key,id);setPending(id)
   const {data,error:e}=await supabase.rpc('apply_website_import',{...scope,p_request:id,p_rows:rows})
   if(e){if(e.code&&/^(22|23|40|42|P0)/.test(e.code)){sessionStorage.removeItem(key);setPending(null)}throw e}
   sessionStorage.removeItem(key);setPending(null);setPreview(null);setNotice(data.applied+' approved pages applied.');onApplied()
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 async function recover(){
  setBusy(true);setError('')
  try{const {data,error:e}=await supabase.rpc('recover_website_import',{...scope,p_request:pending});if(e)throw e
   if(!data){setNotice('The original import is not visible yet. Keep this request and check again.');return}
   sessionStorage.removeItem(key);setPending(null);setPreview(null);setNotice(data.applied+' pages confirmed from the original import.');onApplied()
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 return <section className="space-y-3"><h3>Import existing website</h3><fieldset disabled={busy||!!pending} className="grid gap-3"><label>Public HTTPS domain <input className={field} value={domain} placeholder="example.com" onChange={e=>{setDomain(e.target.value);setPreview(null)}}/></label>
 <label>Optional keyword spreadsheet <input type="file" accept=".csv,.xlsx" onChange={e=>file(e.target.files[0])}/></label><p>Columns: URL, keyword, role, intent, locale. Use primary or supporting for the role. Observed Search Console queries remain in Rankings.</p>
 {sheet&&<label>Worksheet <select value={which} onChange={e=>{selectSheet(Number(e.target.value));setPreview(null)}}>{sheet.map((s,i)=><option key={i} value={i}>{s.name}</option>)}</select></label>}
 <button className={btn} disabled={!domain.trim()} onClick={discover}>Preview website import</button>
 {preview&&<section className="space-y-3"><h4>Review pages and keywords · {preview.origin}</h4>{[...preview.notices,...preview.warnings].map((s,i)=><p key={i}>{s}</p>)}{!preview.candidates.length&&<p>No importable pages discovered.</p>}
 {preview.candidates.map((c,i)=><article key={i} className="rounded border p-3"><label><input type="checkbox" checked={c.selected} disabled={!['new','changed'].includes(c.state)} onChange={e=>change(i,{selected:e.target.checked})}/> {c.state} · {c.meta.url}</label>{c.reason&&<p>{c.reason}</p>}
 <p>HTTP {c.meta.status} · WordPress {c.wpId||'ID unavailable'} · H1: {c.meta.h1||'Missing'}</p><p>Description: {c.meta.description||'Missing'} · Canonical: {c.meta.canonical||'Not declared'}</p>
 <label>Inventory title <input className={field} value={c.title} maxLength={240} disabled={!c.selected} onChange={e=>change(i,{title:e.target.value})}/></label><p>Inventory path {c.path} · Intended URL {c.url||'unset'}</p>
 {c.additions.map((t,j)=><div key={j}><label><input type="checkbox" disabled={!c.selected||t.state!=='new'} checked={t.selected} onChange={e=>change(i,{additions:c.additions.map((k,n)=>n===j?{...k,selected:e.target.checked}:k)})}/> {t.state} · {t.query} · {t.role} · {t.intent} · {t.locale}</label>
 {t.selected&&c.selected&&t.state==='new'&&<fieldset className="flex flex-wrap gap-2">
 {['query','intent','locale','role'].map(k=><label key={k}>{k} <input className={field} value={t[k]} onChange={e=>change(i,{additions:c.additions.map((term,n)=>n===j?{...term,[k]:e.target.value}:term)})}/></label>)}
 </fieldset>}</div>)}</article>)}
 <button className={btn} disabled={!approvedRows(preview.candidates).length} onClick={apply}>Apply selected changes</button></section>}</fieldset>
 {pending&&<button disabled={busy} className={btn} onClick={recover}>Check original import</button>}{busy&&<p role="status">Working…</p>}{notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}<button className={btn} disabled={busy} onClick={onClose}>Close import</button></section>
}
