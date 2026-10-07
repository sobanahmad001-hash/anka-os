import { createClient } from 'npm:@supabase/supabase-js@2.112.4'
import { namedKey } from '../_shared/googleOAuthTokens.ts'
import { createProjectImportHttpHandler } from '../_shared/projectSpreadsheetHttp.ts'

// Release coordination must enable this only after native/security/browser gates.
// Request bodies, model settings and provider activation never enable it.
export const IMPORT_RELEASE_READY = true
export const handleRequest=createProjectImportHttpHandler({releaseReady:IMPORT_RELEASE_READY,clients:()=>{
  const url=Deno.env.get('SUPABASE_URL')||''
  return {
    auth:createClient(url,namedKey('SUPABASE_PUBLISHABLE_KEYS','SUPABASE_ANON_KEY'),{auth:{persistSession:false}}),
    admin:createClient(url,namedKey('SUPABASE_SECRET_KEYS','SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false}}),
  }
}})
if(import.meta.main)Deno.serve(handleRequest)
