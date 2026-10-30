const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const id=x=>{if(typeof x!=='string'||!UUID.test(x))throw Error('Exact canonical identifier required');return x}
const kinds=['project_task','engagement_work_item','conversation']
export function assetReferences(value){
 if(!Array.isArray(value)||value.length>50)throw Error('Choose at most fifty existing assets')
 const result=value.map(a=>{if(!a||Object.keys(a).sort().join(',')!=='id,kind'||!['website_page','campaign_asset'].includes(a.kind))throw Error('Typed asset required');return {kind:a.kind,id:id(a.id).toLowerCase()}})
 if(new Set(result.map(a=>a.kind+':'+a.id)).size!==result.length)throw Error('Duplicate asset reference')
 return result.sort((a,b)=>(a.kind+':'+a.id).localeCompare(b.kind+':'+b.id))
}
const scope=v=>({p_organization_id:id(v.organizationId),p_project_id:id(v.projectId)})
const subject=v=>{if(!kinds.includes(v.subjectKind))throw Error('Typed original subject required');return {...scope(v),p_subject_kind:v.subjectKind,p_subject_id:id(v.subjectId)}}
const change=v=>{if(!Number.isSafeInteger(v.expectedRevision)||v.expectedRevision<0||v.subjectKind==='conversation'&&v.expectedRowVersion!==null||v.subjectKind!=='conversation'&&(!Number.isSafeInteger(v.expectedRowVersion)||v.expectedRowVersion<1))throw Error('Current relationship and work versions required');return {...subject(v),p_expected_revision:v.expectedRevision,p_expected_row_version:v.expectedRowVersion,p_assets:assetReferences(v.assets)}}
export function createProjectAssetRelationsRepository(client){
 const call=async(name,args,options)=>{if(options?.signal?.aborted)throw new DOMException('Context changed','AbortError');let q=client.rpc(name,args);if(options?.signal&&q.abortSignal)q=q.abortSignal(options.signal);const {data,error}=await q;if(error)throw Object.assign(new Error(error.message||'Relationship request failed'),{cause:error,code:error.code});if(options?.signal?.aborted)throw new DOMException('Context changed','AbortError');return data}
 return Object.freeze({
  read:(v,o)=>call('read_project_asset_relations',subject(v),o),
  review:(v,o)=>call('review_project_asset_relations',change(v),o),
  save(v,o){if(v.confirmed!==true||!/^[a-f0-9]{64}$/.test(v.reviewSha256||''))throw Error('Review and explicitly confirm the exact relationship');return call('save_project_asset_relations',{...change(v),p_review_sha256:v.reviewSha256,p_request_id:id(v.requestId)},o)},
  recover:(v,o)=>call('recover_project_asset_relations',{...scope(v),p_request_id:id(v.requestId)},o),
  options(v,o){if(typeof (v.search??'')!=='string'||(v.search||'').length>120||!Number.isSafeInteger(v.offset??0)||(v.offset??0)<0||(v.offset??0)>10000)throw Error('Bounded asset search required');return call('list_project_asset_relation_options',{...scope(v),p_search:v.search||'',p_offset:v.offset||0},o)},
  forAsset(v,o){if(!['website_page','campaign_asset'].includes(v.assetKind))throw Error('Typed asset required');return call('list_project_asset_work_links',{...scope(v),p_asset_kind:v.assetKind,p_asset_id:id(v.assetId)},o)},
  conversations(v,o){if(!['website_page','campaign_asset'].includes(v.assetKind)||!Number.isSafeInteger(v.offset??0)||(v.offset??0)<0||(v.offset??0)>10000)throw Error('Bounded typed asset conversation lookup required');return call('list_project_asset_conversations',{...scope(v),p_asset_kind:v.assetKind,p_asset_id:id(v.assetId),p_offset:v.offset||0},o)},
 })
}
