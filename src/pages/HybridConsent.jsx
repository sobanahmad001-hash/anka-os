import {useEffect,useState} from 'react'
import {Link,useLocation} from 'react-router-dom'
import {useAuth} from '../context/AuthContext'
import {supabase} from '../lib/supabase'

export default function HybridConsent(){
  const {user,loading}=useAuth(),location=useLocation()
  const authorizationId=new URLSearchParams(location.search).get('authorization_id')
  const [details,setDetails]=useState(null),[projects,setProjects]=useState([]),[project,setProject]=useState(''),[save,setSave]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false),[grants,setGrants]=useState([])
  useEffect(()=>{
    if(!user)return
    let active=true
    async function load(){
      const [p,g]=await Promise.all([supabase.from('projects').select('id,organization_id,name').is('archived_at',null).order('name'),supabase.rpc('list_hybrid_oauth_grants')])
      if(p.error||g.error)throw new Error('Connection settings are unavailable.')
      if(active){setProjects(p.data);setGrants(g.data)}
      if(authorizationId){
        const {data,error}=await supabase.auth.oauth.getAuthorizationDetails(authorizationId)
        if(error)throw error
        if(data.redirect_url){window.location.assign(data.redirect_url);return}
        if(active)setDetails(data)
      }
    }
    load().catch(e=>{if(active)setError(e.message)})
    return()=>{active=false}
  },[user,authorizationId])
  async function decide(allow){
    setBusy(true);setError('')
    try{
      if(allow){
        const selected=projects.find(p=>p.id===project)
        if(!selected)throw new Error('Choose a project.')
        const {error}=await supabase.rpc('set_hybrid_oauth_grant',{p_client:details.client.id,p_org:selected.organization_id,p_project:selected.id,p_save:save,p_revoke:false})
        if(error)throw new Error('Current team access to this project is required.')
      }
      const {data,error}=await supabase.auth.oauth[allow?'approveAuthorization':'denyAuthorization'](authorizationId,{skipBrowserRedirect:true})
      if(error)throw error
      window.location.assign(data.redirect_url)
    }catch(e){setError(e.message);setBusy(false)}
  }
  async function revoke(g){
    setBusy(true);setError('')
    const {error}=await supabase.rpc('set_hybrid_oauth_grant',{p_client:g.client_id,p_org:g.organization_id,p_project:g.project_id,p_save:false,p_revoke:true})
    if(error)setError('Could not disconnect. Try again.')
    else setGrants(grants.filter(x=>x.client_id!==g.client_id))
    setBusy(false)
  }
  return <main className="min-h-screen bg-slate-950 text-slate-100 p-6"><section className="max-w-xl mx-auto space-y-5 py-12">
    <h1 className="text-2xl font-semibold">Connect ChatGPT to Anka</h1>
    {loading?<p>Loading…</p>:!user?<><p>Sign in to Anka to choose the project you want to share.</p><Link className="underline" to={`/login?returnTo=${encodeURIComponent(location.pathname+location.search)}`}>Sign in to Anka</Link></>:<>
      {details&&<>
        <p><strong>{details.client.name}</strong> is requesting a connection. Your sign-in identity scopes: {details.scope||'none'}.</p>
        <label className="block">Project<select className="block w-full bg-slate-800 p-3 mt-2" value={project} onChange={e=>setProject(e.target.value)}><option value="">Choose a project</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <p>Allow reading approved shared context references for this project. Private chats and source bodies are excluded.</p>
        <label className="flex gap-3"><input type="checkbox" checked={save} onChange={e=>setSave(e.target.checked)}/>Also allow saving supplied drafts to cards I can edit.</label>
        <p className="text-sm text-slate-400">This does not approve or publish work, run paid services, or grant access to another project. You can disconnect below.</p>
        <div className="flex gap-4"><button className="bg-indigo-600 rounded px-4 py-2 disabled:opacity-50" disabled={busy||!project} onClick={()=>decide(true)}>Allow connection</button><button disabled={busy} onClick={()=>decide(false)}>Deny</button></div>
      </>}
      {!authorizationId&&<p>Start from the Anka connection in ChatGPT to sign in and choose a project.</p>}
      {grants.length>0&&<section className="space-y-3"><h2 className="text-lg">Your active connections</h2>{grants.map(g=><div key={g.client_id} className="border border-slate-700 p-3 rounded"><p>{g.project_name} · Read context{g.can_save?' and save drafts':''}</p><button className="underline" disabled={busy} onClick={()=>revoke(g)}>Disconnect</button></div>)}</section>}
      <Link className="block underline" to="/sphere/workspace">Back to Work</Link>
    </>}
    {error&&<p role="alert" className="text-red-300">{error}</p>}
  </section></main>
}
