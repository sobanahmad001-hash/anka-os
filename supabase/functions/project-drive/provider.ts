export const driveScope='https://www.googleapis.com/auth/drive.metadata.readonly'
export const folderType='application/vnd.google-apps.folder'
export const validId=(id:unknown):id is string=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(id)
export class DriveError extends Error{
 constructor(public code:string,message:string,public status:number){super(message)}
}
type FileMeta={id:string;name:string;mimeType:string;parents?:string[];trashed?:boolean}
const fields='id,name,mimeType,parents,trashed'
export async function driveRead(token:string,path:string,params:Record<string,string>,fetcher=fetch){
 const url=new URL('https://www.googleapis.com/drive/v3/'+path)
 url.search=new URLSearchParams(params).toString()
 const r=await fetcher(url,{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(12000)})
 if(!r.ok){
  if(r.status===401)throw new DriveError('consent','Google authorization expired or was revoked. Connect again.',401)
  if(r.status===404)throw new DriveError('unavailable','Unavailable to this Google account. Access may have changed or the item may have been removed.',404)
  if(r.status===403)throw new DriveError('denied','Google denied this request. Check Drive API configuration and account permissions.',403)
  throw new DriveError('provider','Google Drive is temporarily unavailable.',502)
 }
 return await r.json()
}
export function fileState(file:FileMeta,folder:string){
 if(file.trashed)return 'trashed'
 if(!file.parents?.includes(folder))return 'moved'
 if(file.mimeType===folderType||file.mimeType==='application/vnd.google-apps.shortcut')return 'unsupported'
 return 'available'
}
export function searchParams(folder:string|null,term:string,page:string){
 const parts=['trashed = false']
 if(folder){if(!validId(folder))throw new Error('Invalid folder');parts.push("'"+folder+"' in parents","mimeType != '"+folderType+"'","mimeType != 'application/vnd.google-apps.shortcut'")}
 else parts.push("mimeType = '"+folderType+"'")
 if(term)parts.push("name contains '"+term.replaceAll('\\','\\\\').replaceAll("'","\\'")+"'")
 return {q:parts.join(' and '),fields:'nextPageToken,incompleteSearch,files('+fields+')',pageSize:'50',orderBy:'name',supportsAllDrives:'true',includeItemsFromAllDrives:'true',...(page?{pageToken:page}:{})}
}
export async function metadata(token:string,id:string,fetcher=fetch):Promise<FileMeta>{
 if(!validId(id))throw new DriveError('invalid','Invalid Google Drive ID.',400)
 return await driveRead(token,'files/'+id,{fields,supportsAllDrives:'true'},fetcher)
}
