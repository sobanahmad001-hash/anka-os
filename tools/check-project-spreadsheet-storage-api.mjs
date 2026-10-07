// Actual Storage API acceptance, only in an existing reviewed local Supabase QA
// runtime. No service setup, credentials acquisition, production or deletion.
import assert from 'node:assert/strict'
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { loadOwnedImportScope } from '../supabase/functions/_shared/projectSpreadsheetServer.ts'
import { createProjectImportHttpHandler } from '../supabase/functions/_shared/projectSpreadsheetHttp.ts'
import { spreadsheetSourceIdentity } from '../src/data/projectSpreadsheetPreview.js'
import { syntheticImportWorkbook } from './project-spreadsheet-synthetic-fixture.js'
let stage='runtime prerequisites'
try {
 assert.equal(process.env.IMPORTER_QA_RUNTIME_APPROVED,'synthetic-local-storage','Review the existing local Storage runtime and fixture lineage first')
 const url=new URL(process.env.IMPORTER_QA_URL||'')
 assert(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.port&&url.pathname==='/','Exact local QA API origin required')
 for(const name of ['IMPORTER_QA_ANON_KEY','IMPORTER_QA_SERVICE_KEY','IMPORTER_QA_ACCESS_TOKEN'])assert(process.env[name],'Already configured local QA credentials/session required; this runner never obtains them')
 const guardedFetch=(input,init={})=>{const target=new URL(input instanceof Request?input.url:String(input));assert.equal(target.origin,url.origin,'Remote request denied');return fetch(input,{...init,redirect:'error',signal:AbortSignal.timeout(20000)})}
 const options={auth:{persistSession:false,autoRefreshToken:false},global:{fetch:guardedFetch}}
 const admin=createClient(url.href,process.env.IMPORTER_QA_SERVICE_KEY,options),anon=createClient(url.href,process.env.IMPORTER_QA_ANON_KEY,options)
 stage='existing synthetic Auth session'
 const {data:auth,error:authError}=await anon.auth.getUser(process.env.IMPORTER_QA_ACCESS_TOKEN)
 assert(!authError&&auth.user?.id==='99999999-9999-4999-8999-999999999902','Existing synthetic QA actor session required')
 const identity={organizationId:'99999999-9999-4999-8999-999999999901',actorId:auth.user.id},conversation='8f000000-0000-4000-8000-000000000001'
 const handler=createProjectImportHttpHandler({releaseReady:true,clients:()=>({auth:anon,admin})})
 const action=async body=>{const response=await handler(new Request(url.href+'functions/v1/project-chat-import',{method:'POST',headers:{Authorization:'Bearer '+process.env.IMPORTER_QA_ACCESS_TOKEN,'Content-Type':'application/json'},body:JSON.stringify(body)}));assert.equal(response.status,200,'Actual Auth-backed HTTP handler must accept reviewed synthetic request');return response.json()}
 const scope=await loadOwnedImportScope(admin,identity.organizationId,identity.actorId,conversation)
 assert.equal(scope.projectId,'99999999-9999-4999-8999-999999999974','Existing synthetic QA project required')
 stage='real private bucket constraints'
 const {data:bucket,error:bucketError}=await admin.storage.getBucket('department-chat-attachments')
 assert(!bucketError&&bucket?.public===false&&bucket.file_size_limit===5242880,'Authentic private QA Storage bucket constraints required')
 for(const mime of ['text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])assert(bucket.allowed_mime_types?.includes(mime),'Importer QA bucket MIME delta required')
 const evidence={scope:'Existing synthetic local Supabase Auth/Storage API only; no production/customer/provider/browser acceptance',cases:[]}
 for(const [extension,mime,bytes] of [['csv','text/csv',new TextEncoder().encode('page_key,title,planned_path\nsynthetic:storage,Synthetic storage,/synthetic-storage\n')],['xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',syntheticImportWorkbook()]]) {
  const attachment=crypto.randomUUID(),body={organization_id:identity.organizationId,conversation_id:conversation,attachment_id:attachment}
  // Inject the test capability only into the exported server function in this
  // local harness. Production HTTP/frontend constants remain false, untouched.
  stage=extension+' reserve and signed upload'
  const reservation=await action({...body,action:'reserve_source',original_name:'synthetic-storage.'+extension,claimed_mime:mime,data_classification:'internal'})
  const upload=await anon.storage.from('department-chat-attachments').uploadToSignedUrl(reservation.upload.path,reservation.upload.token,bytes,{contentType:mime,upsert:false})
  assert(!upload.error,'Actual signed Storage upload must succeed')
  const repeated=await anon.storage.from('department-chat-attachments').uploadToSignedUrl(reservation.upload.path,reservation.upload.token,bytes,{contentType:mime,upsert:false})
  assert(repeated.error,'Original signed upload must not overwrite an existing source')
  stage=extension+' actual copy/finalization/recovery'
  const finished=await action({...body,action:'finish_source'}),hash=await spreadsheetSourceIdentity(bytes)
  assert.equal(finished.status,'reference_only');assert.equal(finished.sha256_hex,hash)
  const replay=await action({...body,action:'finish_source'})
  assert.equal(replay.attachment_id,attachment);assert.equal(replay.sha256_hex,hash)
  const recovered=await action({...body,action:'source_status'})
  assert.equal(recovered.id,attachment);assert.equal(recovered.sha256_hex,hash)
  stage=extension+' private final object'
  const finalPath=identity.organizationId+'/'+conversation+'/final/'+attachment
  const direct=await anon.storage.from('department-chat-attachments').download(finalPath)
  assert(direct.error,'Anonymous final-object read must be denied')
  const final=await admin.storage.from('department-chat-attachments').download(finalPath)
  assert(!final.error,'Server-authorized final-object read must succeed')
  assert.equal(await spreadsheetSourceIdentity(new Uint8Array(await final.data.arrayBuffer())),hash)
  const {data:record,error:recordError}=await admin.from('department_chat_attachments').select('status,source_kind,ai_use_allowed,share_with_recipients,extracted_text').eq('id',attachment).eq('uploaded_by',identity.actorId).single()
  assert(!recordError&&record.source_kind==='project_spreadsheet'&&record.ai_use_allowed===false&&record.share_with_recipients===false&&record.extracted_text===null,'Final source must preserve private reference-only contract')
  evidence.cases.push({extension,signedUpload:true,overwriteDenied:true,actualCopyAndFinalize:true,exactRecovery:true,anonymousReadDenied:true,hashVerified:true,privateReferenceOnly:true,fixtureAttachmentId:attachment,sha256:hash})
 }
 stage='write sanitized evidence'
 const output=process.argv[2];assert(output,'Evidence output path required');await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(evidence,null,2)+'\n')
 console.log('PASS actual synthetic local CSV/XLSX Storage API lifecycle; fixtures retained, no canonical import')
} catch {
 console.error('FAIL actual Storage API gate at '+stage+'; report sanitized local diagnostics separately. No acceptance claimed.')
 process.exitCode=1
}
