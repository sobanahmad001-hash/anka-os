import {driveRead,fileState,folderType,metadata,searchParams} from './provider.ts'
function equal(actual:unknown,expected:unknown){if(actual!==expected)throw new Error('Expected '+expected+'; got '+actual)}
Deno.test('a Drive file keeps its provider ID when moved and becomes unavailable to its old project folder',()=>{
 const f={id:'file-7',name:'Design',mimeType:'application/pdf',parents:['folder-A']}
 equal(fileState(f,'folder-A'),'available');equal(fileState(f,'folder-B'),'moved')
 equal(fileState({...f,parents:['folder-B']},'folder-A'),'moved')
 equal(fileState({...f,trashed:true},'folder-A'),'trashed')
 equal(fileState({...f,mimeType:folderType},'folder-A'),'unsupported')
})
Deno.test('each folder query is server scoped and user search cannot inject a Drive query',()=>{
 const a=searchParams('folder-A',"x' or trashed = true or 'y",''),b=searchParams('folder-B','','next')
 equal(a.q.includes("'folder-A' in parents"),true);equal(a.q.includes("x\\' or"),true)
 equal(b.q.includes("'folder-B' in parents"),true);equal(b.pageToken,'next')
})
Deno.test('Google 401, 403 and 404 remain distinct without echoing provider response or token',async()=>{
 for(const [status,code] of [[401,'consent'],[403,'denied'],[404,'unavailable']] as const){
  try{await driveRead('private','files',{},async()=>new Response('private',{status}));throw Error('unexpected success')}
  catch(e){equal((e as {code:string}).code,code);equal(String(e).includes('private'),false)}
 }
})
Deno.test('metadata targets the fixed Google API endpoint and rejects malformed provider IDs',async()=>{
 let seen=''
 await metadata('test','file-A',async url=>{seen=String(url);return Response.json({id:'file-A'})})
 equal(seen.startsWith('https://www.googleapis.com/drive/v3/files/file-A?'),true)
 try{await metadata('test','../files');throw Error('unexpected success')}catch(e){equal((e as {code:string}).code,'invalid')}
})
