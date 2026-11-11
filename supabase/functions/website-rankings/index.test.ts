import {handle} from './index.ts'
const project='10000000-0000-4000-8000-000000000001', other='10000000-0000-4000-8000-000000000002',page='10000000-0000-4000-8000-000000000003',organization='10000000-0000-4000-8000-000000000004'
const site='https://sample.test/',url=site+'home'
const env=(key:string)=>({SUPABASE_URL:'https://db.example.test',SUPABASE_ANON_KEY:'public-test',WINDSOR_GSC_PROJECTS:JSON.stringify({[project]:{organization,account:'acct',site,key:'synthetic'}})}[key])
const body={organization,project,page,start:'2026-01-02',end:'2026-01-02',country:'usa',device:'mobile'}
const make=(b:object,auth=true)=>new Request('https://local.test/',{method:'POST',headers:auth?{Authorization:'Bearer fixture'}:{},body:JSON.stringify(b)})
function assert(v:unknown){if(!v)throw Error('unexpected report')}
Deno.test('exact server binding and signed-in authorization precede provider read',async()=>{
 let calls=0
 const network:typeof fetch=async(input,init)=>{
  const u=new URL(input instanceof Request?input.url:String(input))
  if(u.host==='db.example.test'){
    assert(new Headers(init?.headers|| (input instanceof Request?input.headers:undefined)).get('authorization')==='Bearer fixture')
    return Response.json([{id:page,url,targets:[{query:'selected'}],sourceTargets:[],mode:'targets'}])
  }
  calls++
  assert(u.host==='connectors.windsor.ai'&&u.searchParams.get('_select_accounts')==='acct'&&u.searchParams.get('date_from')==='2026-01-01')
  const row={account_id:'acct',site,page:url,date:'2026-01-02',query:'selected',country:'usa',device:'mobile',position:2,clicks:0,impressions:5}
  return Response.json({data:[row,{...row,page:site+'other'},{...row,query:'discovered'},{...row,site:'sc-domain:other.test'},{...row,account_id:'wrong'},{...row,country:'can'},{...row,page:site+'unrelated',query:'unassigned'}]})
 }
 assert((await handle(make(body,false),env,network)).status===401)
 assert((await (await handle(make({...body,project:other}),env,network)).json()).state==='unconfigured')
 assert(calls===0)
 const report=await (await handle(make(body),env,network)).json()
 assert(report.state==='ready'&&report.rows.length===3&&report.rows[0].clicks===0&&calls===1)
})
Deno.test('denied project access prevents provider lookup',async()=>{
 const network:typeof fetch=async(input)=>{assert(String(input).startsWith('https://db.example.test'));return Response.json({message:'denied'},{status:403})}
 assert((await handle(make(body),env,network)).status===403)
})
