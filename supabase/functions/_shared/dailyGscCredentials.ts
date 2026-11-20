import {googleAccessToken} from './googleOAuthTokens.ts'
import {ReportingProviderFailure} from './reportingRefreshWorker.js'

export function dailyGscTokenReader(admin:any){
 return async(context:any,signal?:AbortSignal)=>{
  async function verify(){
   if(signal?.aborted)throw Error('Aborted')
   if(context.provider!=='google_search_console'||context.resource_kind!=='gsc_site')throw new ReportingProviderFailure('permission_denied')
   const {data,error}=await admin.rpc('website_tracking_token_scope',{p_org:context.organization_id,p_project:context.project_id,p_binding:context.binding_id,p_checksum:context.context_checksum})
   if(error||data!==true)throw new ReportingProviderFailure('permission_denied')
  }
  await verify()
  let token:string
  try{token=await googleAccessToken(admin,context.connection_id,'google_search_console')}
  catch{throw new ReportingProviderFailure('disconnected')}
  await verify()
  return token
 }
}
