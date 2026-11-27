import {rejectOAuthClients} from './oauthBoundary.ts'
const token=(claims:object)=>`header.${btoa(JSON.stringify(claims))}.signature`
Deno.test('OAuth identity cannot enter ordinary handlers; direct sessions retain existing verification',async()=>{
  let calls=0
  const guarded=rejectOAuthClients(()=>{calls++;return new Response(null,{status:204})})
  for(const claims of [{client_id:'client'},{role:'hybrid_mcp'}]){
    const response=await guarded(new Request('https://example.test',{headers:{Authorization:`Bearer ${token(claims)}`}}))
    if(response.status!==403)throw Error('OAuth boundary failed')
  }
  if(calls!==0)throw Error('Privileged handler was reached')
  await guarded(new Request('https://example.test',{headers:{Authorization:`Bearer ${token({role:'authenticated'})}`}}))
  if(Number(calls)!==1)throw Error('Direct session flow changed')
})

