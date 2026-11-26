import {createClient, type SupabaseClient} from 'npm:@supabase/supabase-js@2.112.4'
import {createHybridMcpHandler} from '../_shared/hybridMcp.js'
import {createSuppliedDraft} from '../_shared/hybridDraft.js'

const base=Deno.env.get('SUPABASE_URL')!
const resource=`${base}/functions/v1/hybrid-mcp`
const metadata=`${resource}/.well-known/oauth-protected-resource`
const uuid=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const handler=createHybridMcpHandler({
  authenticate:async(request:Request)=>{
    const header=request.headers.get('authorization')
    if(!header?.startsWith('Bearer '))return null
    const client=createClient(base,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:header}},auth:{persistSession:false,autoRefreshToken:false}})
    const token=header.slice(7)
    const {data,error}=await client.auth.getClaims(token)
    const c=data?.claims
    if(error||!c||c.iss!==`${base}/auth/v1`||c.aud!==resource||c.role!=='hybrid_mcp'||typeof c.client_id!=='string'||!uuid.test(c.client_id)||!c.exp||c.exp<=Date.now()/1000)return null
    // The same Supabase issuer/resource uses this caller token for its narrow RPCs.
    // SQL checks the current grant and native card authority on every operation.
    return {client,authorize:async()=>true}
  },
  execute:async({client,name,input}: {client:SupabaseClient,name:string,input:Record<string,unknown>})=>{
    if(name==='content.create_draft')return createSuppliedDraft(client,input)
    if(Object.keys(input).length!==2||typeof input.organization_id!=='string'||typeof input.project_id!=='string'||!uuid.test(input.organization_id)||!uuid.test(input.project_id))throw new Error('Exact scope required')
    const {data,error}=await client.rpc('hybrid_mcp_context',{p_org:input.organization_id,p_project:input.project_id})
    if(error)throw error
    return data
  },
})
export async function handleRequest(request:Request){
  if(new URL(request.url).pathname.endsWith('/.well-known/oauth-protected-resource'))return Response.json({resource,authorization_servers:[`${base}/auth/v1`],scopes_supported:['email'],bearer_methods_supported:['header']})
  const response=await handler(request)
  if(response.status===401)response.headers.set('WWW-Authenticate',`Bearer resource_metadata="${metadata}"`)
  return response
}
if(import.meta.main)Deno.serve(handleRequest)



