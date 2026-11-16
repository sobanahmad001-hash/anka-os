import {createClient} from 'npm:@supabase/supabase-js@2.112.4'
import {driveRead,DriveError,fileState,folderType,metadata,searchParams} from './provider.ts'
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization,apikey,x-client-info,content-type','Access-Control-Allow-Methods':'POST,OPTIONS','Cache-Control':'no-store'}
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers})
async function checked(q:PromiseLike<{data:unknown,error:unknown}>){
 const {data,error}=await q
 if(error){const e=error as {code?:string};throw new DriveError('scope',e.code==='40001'?'Folder changed. Reopen Drive.':'Project or card permission unavailable.',e.code==='40001'?409:403)}
 return data
}
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response(null,{headers})
 if(req.method!=='POST')return reply({error:'POST required'},405)
 try{
  const auth=req.headers.get('Authorization')
  if(!auth?.startsWith('Bearer '))return reply({error:'Sign in required'},401)
  const url=Deno.env.get('SUPABASE_URL')!,db=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:auth}},auth:{persistSession:false}})
  const {data:{user},error}=await db.auth.getUser(auth.slice(7))
  if(error||!user)return reply({error:'Sign in required'},401)
  const b=await req.json(),scope={p_org:b.org,p_project:b.project}
  const settings=await checked(db.rpc('work_drive_settings',scope)) as {folder:string|null;manage:boolean;revision:number;name:string|null}
  const clientId=Deno.env.get('GOOGLE_OAUTH_CLIENT_ID')||''
  if(b.action==='settings')return reply({...settings,clientId})
  if(!Number.isSafeInteger(b.revision)||settings.revision!==b.revision)return reply({error:'Folder changed. Reopen Drive.'},409)
  if(['folders','bind','disconnect'].includes(b.action)&&!settings.manage)return reply({error:'Project management required'},403)
  if(b.action==='disconnect')return reply(await checked(db.rpc('save_work_drive_selection',{...scope,p_action:'disconnect',p_revision:b.revision})))
  const token=b.token
  if(!clientId||typeof token!=='string'||token.length>8192||!token)return reply({error:'Google connection required',code:'consent'},401)
  if(!['folders','bind','files','attach','status'].includes(b.action))return reply({error:'Unknown operation'},400)
  if(b.action==='folders'||b.action==='files'){
   if(b.action==='files'){
    if(!settings.folder)return reply({error:'Choose a project folder first'},409)
    const f=await metadata(token,settings.folder)
    if(f.trashed||f.mimeType!==folderType)throw new DriveError('unavailable','The connected folder is unavailable.',409)
   }
   const opts=searchParams(b.action==='folders'?null:settings.folder,String(b.search||'').slice(0,160),String(b.page||'').slice(0,4096))
   return reply(await driveRead(token,'files',opts))
  }
  const item=await metadata(token,b.file)
  if(b.action==='bind'){
   if(item.trashed||item.mimeType!==folderType)return reply({error:'Choose an available folder'},400)
  }else{
   if(!settings.folder)return reply({error:'No folder connected'},409)
   const folder=await metadata(token,settings.folder)
   if(folder.trashed||folder.mimeType!==folderType)throw new DriveError('unavailable','The connected folder is unavailable.',409)
   const state=fileState(item,settings.folder)
   if(b.action==='status')return reply({state})
   if(state!=='available')return reply({error:'File is '+state+'; choose a current file from the project folder.'},409)
  }
  const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}})
  const proof=await checked(admin.rpc('issue_work_drive_proof',{p_project:b.project,p_actor:user.id,p_action:b.action,p_file:item.id,p_name:item.name,p_folder:settings.folder,p_revision:b.revision}))
  return reply(await checked(db.rpc('save_work_drive_selection',{...scope,p_action:b.action,p_revision:b.revision,p_proof:proof,p_card_kind:b.cardKind??null,p_card_id:b.cardId??null})))
 }catch(e){return e instanceof DriveError?reply({error:e.message,code:e.code},e.status):reply({error:'Drive request could not be completed.'},500)}
})
