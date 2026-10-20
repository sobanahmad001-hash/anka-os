import {isAnimationModel} from '../_shared/designModelLineup.js'
type Json=Record<string,any>
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function privateAnimationSources(admin:any,body:Json,actor:string){
 const context=body.context;
 if(!context||context.kind!=='private'||typeof context.id!=='string'||!uuid.test(context.id)||Object.keys(context).some(k=>!['kind','id'].includes(k)))throw Error('Exact private Design conversation required');
 const {data,error}=await admin.rpc('read_design_private_attachments',{p_org:admin.organizationId,p_conversation:context.id,p_actor:actor});
 if(error||!Array.isArray(data)||data.length>100)throw Error('Private image access could not be confirmed');
 if(data.some(a=>a.organization_id!==admin.organizationId||a.conversation_id!==context.id||a.owner_id!==actor))throw Error('Private image scope changed');
 return data.filter(a=>a.status==='ready'&&a.extraction_kind==='reference_only'&&['image/png','image/jpeg'].includes(a.verified_mime)&&a.declared_bytes>0&&a.declared_bytes<=5242880&&/^[a-f0-9]{64}$/.test(a.expected_sha256)).map(a=>({kind:'private_attachment',id:a.id,checksum:a.expected_sha256,mime_type:a.verified_mime,label:a.original_name+' · private upload'}));
}
export async function resolvePrivateAnimationSource(admin:any,request:Json,actor:string){
 if(!isAnimationModel(request.model_id)||request.input_versions?.length!==1)throw Error('Private uploaded images require the approved animation model');
 const input=request.input_versions[0],sources=await privateAnimationSources(admin,{context:request.context},actor);
 if(!sources.some(s=>s.id===input.id&&s.checksum===input.checksum))throw Error('Private original is unavailable or changed');
 return {bucket:'design-private-attachments',path:admin.organizationId+'/'+actor+'/'+request.context.id+'/'+input.id+'/original'};
}
