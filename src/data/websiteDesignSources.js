import {readWebsiteArchitectureIdentities} from './projectWebsitePageContracts.js'
import {normalizeWebsitePath} from './contentStudio.js'
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA=/^[a-f0-9]{64}$/
function required(value,label){if(typeof value!=='string'||!UUID.test(value))throw new TypeError(`Exact ${label} required`);return value}
function context(workspace,scope){
 for(const field of ['organizationId','projectId','engagementId'])required(scope?.[field],field)
 const engagement=workspace?.engagement
 if(!engagement||engagement.id!==scope.engagementId||engagement.project_id!==scope.projectId||engagement.organization_id!==scope.organizationId||!engagement.brand_id)throw new TypeError('Current exact project Design context required')
 return engagement
}
function sourceArtifact(workspace,scope,version,type){
 const engagement=context(workspace,scope)
 const artifact=workspace.artifacts?.find(a=>a.id===version?.artifact_id)
 if(!artifact||artifact.organization_id!==scope.organizationId||artifact.project_id!==scope.projectId||artifact.engagement_id!==scope.engagementId||artifact.brand_id!==engagement.brand_id||artifact.artifact_type!==type||artifact.archived_at||version.organization_id!==scope.organizationId||!UUID.test(version.id)||!SHA.test(version.content_checksum))return null
 return artifact
}
// These are visible source candidates, never proof of current server approval.
// list_project_website_pages independently resolves the chosen approved architecture.
export function websiteArchitectureOptions(workspace,scope){
 context(workspace,scope)
 return (workspace.versions||[]).flatMap(version=>{
  const artifact=sourceArtifact(workspace,scope,version,'website_architecture')
  return artifact?[{artifact,version}]:[]
 })
}
function selectedRegisteredPage(page){
 if(!page||!UUID.test(page.page_id)||!page.source?.page_key||typeof page.source.path!=='string'||!page.source.path)throw new TypeError('Select an existing registered page from the approved architecture')
 return page.source
}
export function websiteContentOptions(workspace,scope,page){
 context(workspace,scope);const source=selectedRegisteredPage(page),target=normalizeWebsitePath(source.path)
 if(!target)throw new TypeError('Exact planned page path required')
 return (workspace.versions||[]).flatMap(version=>{
  const artifact=sourceArtifact(workspace,scope,version,'content')
  if(!artifact||!Array.isArray(version.content?.pages))return []
  // Never fall back to a same-title page or initial/older path after a rename.
  const matches=version.content.pages.filter(p=>normalizeWebsitePath(p?.page_path)===target)
  if(matches.length!==1||matches[0].page_key&&matches[0].page_key!==source.page_key)return []
  return [{artifact,version,page:matches[0]}]
 })
}
export function bindWebsiteContentSource(workspace,scope,{page,architectureReference,contentVersionId}){
 context(workspace,scope);const source=selectedRegisteredPage(page)
 required(architectureReference?.artifact_id,'architecture artifact');required(architectureReference?.artifact_version_id,'architecture version');required(architectureReference?.approval_id,'architecture approval')
 if(!SHA.test(architectureReference.content_checksum||''))throw new TypeError('Exact server architecture checksum required')
 const architecture=websiteArchitectureOptions(workspace,scope).find(row=>row.artifact.id===architectureReference.artifact_id&&row.version.id===architectureReference.artifact_version_id&&row.version.content_checksum===architectureReference.content_checksum)
 if(!architecture)throw new TypeError('Selected server architecture no longer matches this project workspace')
 const identity=readWebsiteArchitectureIdentities(architecture.version.content).find(row=>row.page_key===source.page_key&&row.path===normalizeWebsitePath(source.path))
 if(!identity)throw new TypeError('Registered page selection differs from the exact architecture page')
 const selected=websiteContentOptions(workspace,scope,page).find(row=>row.version.id===contentVersionId)
 if(!selected)throw new TypeError('Choose an unambiguous exact Content version for this registered page')
 for(const field of ['page_brief','draft_copy','meta_title','meta_description','primary_cta'])if(typeof selected.page[field]!=='string'||!selected.page[field].trim())throw new TypeError(`Complete ${field.replaceAll('_',' ')} in Content before designing this page`)
 if(new TextEncoder().encode(JSON.stringify(selected.page)).length>128000)throw new TypeError('Page source exceeds the bounded Design context; resolve it in Content without truncation')
 return structuredClone({scope:{organization_id:scope.organizationId,project_id:scope.projectId,engagement_id:scope.engagementId,page_id:page.page_id,page_key:source.page_key},architecture:{...architectureReference},content:{artifact_id:selected.artifact.id,version_id:selected.version.id,checksum:selected.version.content_checksum,page_path:selected.page.page_path},source_page:selected.page})
}
