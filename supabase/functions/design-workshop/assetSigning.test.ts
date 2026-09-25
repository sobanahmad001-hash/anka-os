import { assertEquals, assertRejects } from 'jsr:@std/assert@1.0.14'
import { signAssetVersions } from './index.ts'
function fixture(rows: any[]) {
  const calls: string[]=[]
  const query:any={select:()=>query,in:()=>query,eq:async()=>({data:rows})}
  const caller={from:()=>query} as any
  const admin={organizationId:'org',storage:{from:(bucket:string)=>({createSignedUrls:async(paths:string[])=>{
    calls.push(bucket);return {data:paths.map(path=>({signedUrl:`https://fixture.invalid/${path}`}))}
  }})}} as any
  return {calls,caller,admin}
}
const image={id:'image',asset_id:'root',mime_type:'image/png',storage_bucket:'design-generated-media',storage_path:'org/assets/root/image/file.png'}
const video={id:'video',asset_id:'root2',mime_type:'video/mp4',storage_bucket:'design-generated-video',storage_path:'org/assets/root2/video/file.mp4'}
Deno.test('canonical image/video signing batches by existing private bucket',async()=>{
  const f=fixture([image,video]);const result=await signAssetVersions(f.admin,f.caller,{version_ids:['image','video']})
  assertEquals(f.calls,['design-generated-media','design-generated-video'])
  assertEquals(Object.keys(result.signed_urls),['image','video'])
})
Deno.test('canonical signer rejects raw private source path and unavailable exact version',async()=>{
  for(const rows of [[{...video,storage_path:'org/direction/job/output.mp4'}],[]]) {
    const f=fixture(rows);await assertRejects(()=>signAssetVersions(f.admin,f.caller,{version_ids:['video']}))
    assertEquals(f.calls,[])
  }
})
