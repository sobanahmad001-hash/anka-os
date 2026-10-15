import React from 'react'
import { createRoot } from 'react-dom/client'
import PeopleAccessProfile from '../src/components/PeopleAccessProfile.jsx'
import { buildPeopleAccessReadModel } from '../src/data/peopleAccessReadModel.js'
import themeCss from '../src/index.css?raw'
import { resolveTheme } from '../src/data/themePreference.js'
const fixtures={active:{name:'Amina · synthetic',status:'active'},revoked:{name:'Omar · synthetic',status:'revoked'},unknown:{name:'Profile unavailable · synthetic',status:'active'}}
const calls=[]
window.peopleAccessPreviewCalls=calls
const repository={
 async list(org,{signal}){signal.throwIfAborted();calls.push('read:list');if(org==='empty')return [];if(org==='error')throw Error('Synthetic authorized read is unavailable');return Object.entries(fixtures).map(([id,row])=>({id,...row}))},
 async read(org,user,{signal}){signal.throwIfAborted();calls.push('read:person');const row=fixtures[user];return buildPeopleAccessReadModel({organization_id:org,members:[{user_id:user,name:row.name}],projects:[{id:'p1',name:'Synthetic launch'}],snapshot:{user_id:user,organization_id:org,legacy_role:'contributor',legacy_department_id:'content',status:row.status,department_memberships:[{id:'d1',department_id:'design',status:'active',source:'synthetic fixture'},{id:'d2',department_id:'marketing',status:'revoked',source:'synthetic fixture',revoked_at:'2026-10-10'}],contributor_designations:[{id:'c1',designation:'executive',status:'active',source:'synthetic fixture'}],project_manager_bindings:[{id:'m1',project_id:'p1',status:'active',source:'synthetic fixture'}]}},user==='unknown'?{state:'unavailable',message:'Synthetic profile read denied'}:{state:'available',full_name:row.name,role:'admin',department:'design'},'2026-10-15T12:00:00Z')},
 async history(org,user,{signal}){signal.throwIfAborted();calls.push('read:history');return user==='revoked'?[{id:'h1',occurredAt:'2026-10-14',reassignmentCount:2}]:[]},
}
function Preview(){
 const [org,setOrg]=React.useState('synthetic'),[theme,setTheme]=React.useState('system'),[revision,setRevision]=React.useState(0)
 const controller=React.useMemo(()=>({org,revision,controller:new AbortController()}),[org,revision]).controller
 React.useEffect(()=>{const media=window.matchMedia('(prefers-color-scheme: dark)'),apply=()=>{document.documentElement.dataset.theme=resolveTheme(theme,media.matches)};apply();media.addEventListener('change',apply);return()=>media.removeEventListener('change',apply)},[theme])
 return <><style>{themeCss.slice(themeCss.indexOf(':root'),themeCss.indexOf('.anka-appearance'))}</style><div style={{padding:12,fontFamily:'system-ui',background:'var(--anka-surface-raised)',color:'var(--anka-ink)'}}><strong>Synthetic read-only preview · no backend/provider connection</strong><label style={{marginLeft:12}}>Scenario <select aria-label="Preview scenario" value={org} onChange={e=>setOrg(e.target.value)}>{['synthetic','other organization','empty','error'].map(s=><option key={s}>{s}</option>)}</select></label><label> Appearance <select aria-label="Preview appearance" value={theme} onChange={e=>setTheme(e.target.value)}>{['system','light','dark'].map(s=><option key={s}>{s}</option>)}</select></label><button onClick={()=>controller.abort()}>Abort access without host render</button><button onClick={()=>setRevision(n=>n+1)}>Renew view</button></div><PeopleAccessProfile organizationId={org} organizationName={org==='synthetic'?'Anka example organization':org} repository={repository} requestSignal={controller.signal}/></>
}
createRoot(document.getElementById('root')).render(<Preview/> )
