import {normalizeWebsitePath,websitePageKey} from './contentStudio.js'
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const record=value=>value && typeof value==='object' && !Array.isArray(value)
const exact=(value,keys)=>record(value) && Object.keys(value).every(key=>keys.includes(key))
const id=(value,label)=>{if(typeof value!=='string' || !UUID.test(value))throw new TypeError(`${label} must be an exact UUID`);return value}
const bounded=(value,max,label,multiline=false)=>{const forbidden=multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/;if(typeof value!=='string' || value!==value.trim() || value.length>max || forbidden.test(value))throw new TypeError(`${label} must be bounded plain text`);return value}
export const WEBSITE_PUBLICATION_STATES=Object.freeze(['planned','in_progress','review','ready','published','retired'])

// Advisory decoder of one explicitly selected canonical version. Native confirmation
// must independently verify authority, checksum, approval and current project scope.
export function readWebsiteArchitectureIdentities(content) {
 if(!record(content) || !Array.isArray(content.pages) || content.pages.length<1 || content.pages.length>1000)throw new TypeError('Choose an architecture with 1–1000 pages')
 const keys=new Set(),paths=new Set()
 const pages=content.pages.map(page=>{
  if(!record(page) || typeof page.slug!=='string')throw new TypeError('Every approved page needs a canonical path')
  const path=normalizeWebsitePath(page.slug),key=websitePageKey(page)
  const legacyPath=page.slug.trim().replaceAll('\\','/').replace(/\/+/g,'/').replace(/^\/+|\/+$/g,'').toLowerCase().replace(/\s+/g,'-')
  if(!String(page.page_key || '').trim() && path!==legacyPath)throw new TypeError('Legacy normalization differs; explicit approved stable-key reconciliation required')
  if(/^[a-z][a-z0-9+.-]*:/i.test(page.slug) || !path || path.length>1200 || /[?#\u0000-\u001f\u007f]/.test(path) || path.split('/').some(segment=>['.','..'].includes(segment)) || !key || key.length>1208 || /[\u0000-\u001f\u007f]/.test(key) || keys.has(key) || paths.has(path))throw new TypeError('Architecture page keys and normalized paths must be unique and valid')
  if(typeof page.title!=='string' || !page.title.trim() || page.title.trim().length>240 || !['hub','service','supporting'].includes(page.page_type))throw new TypeError('Every page needs its published title and supported type')
  keys.add(key);paths.add(path)
  return {page_key:key,path,title:page.title,page_type:page.page_type,parent_page_key:page.parent_page_key || null,source_page:page}
 })
 const byPath=new Map(pages.map(page=>[page.path,page.page_key])),byKey=new Map(pages.map(page=>[page.page_key,page]))
 for(const page of pages){
  const legacyParent=page.source_page.parent_slug ? byPath.get(normalizeWebsitePath(page.source_page.parent_slug)) : null
  if(page.source_page.parent_slug && !legacyParent)throw new TypeError('Legacy parent path is missing from this exact architecture')
  if(page.parent_page_key && legacyParent && page.parent_page_key!==legacyParent)throw new TypeError('Parent key and legacy parent path disagree')
  page.parent_page_key ||= legacyParent || null
  if(page.parent_page_key && !byKey.has(page.parent_page_key))throw new TypeError('Parent key is missing from this exact architecture')
  const ancestors=new Set([page.page_key]);let parent=page.parent_page_key
  while(parent){if(ancestors.has(parent))throw new TypeError('Architecture page hierarchy contains a cycle');ancestors.add(parent);parent=byKey.get(parent)?.parent_page_key}
 }
 return pages
}

export function serializeApprovedArchitectureBinding({organizationId,projectId,engagement,artifact,version,approval,approvalRequest}) {
 id(organizationId,'Organization');id(projectId,'Project')
 if(!engagement || engagement.organization_id!==organizationId || engagement.project_id!==projectId || !artifact || artifact.organization_id!==organizationId || artifact.project_id!==projectId || artifact.engagement_id!==engagement.id || artifact.brand_id!==engagement.brand_id || artifact.artifact_type!=='website_architecture' || !version || version.organization_id!==organizationId || version.artifact_id!==artifact.id || !approval || approval.organization_id!==organizationId || approval.artifact_id!==artifact.id || approval.artifact_version_id!==version.id || approval.engagement_id!==engagement.id || approval.decision!=='approved' || (approvalRequest && (approvalRequest.organization_id!==organizationId || approvalRequest.artifact_version_id!==version.id || approvalRequest.status!=='completed')))throw new TypeError('Exact same-project approved architecture and resolved approval required')
 id(engagement.id,'Engagement');id(engagement.brand_id,'Brand');if(approvalRequest)id(approvalRequest.id,'Governed approval request');id(artifact.id,'Canonical architecture');id(version.id,'Exact architecture version');id(approval.id,'Exact approval')
 if(typeof version.content_checksum!=='string' || !/^[a-f0-9]{64}$/.test(version.content_checksum))throw new TypeError('Exact canonical architecture checksum required')
 const pages=readWebsiteArchitectureIdentities(version.content)
 return {organization_id:organizationId,project_id:projectId,engagement_id:engagement.id,brand_id:engagement.brand_id,architecture_approval_request_id:approvalRequest?.id || null,architecture_artifact_id:artifact.id,architecture_version_id:version.id,architecture_approval_id:approval.id,architecture_checksum:version.content_checksum,page_keys:pages.map(page=>page.page_key)}
}

export function serializeWebsitePageUrl(value,label='Page URL') {
 if(value===null || value==='')return null
 bounded(value,2048,label)
 let url;try{url=new URL(value)}catch{throw new TypeError(`${label} must be an absolute HTTP(S) URL`)}
 if(!['http:','https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.hash || url.search || value.includes('\\') || /\/(?:\.|%2e)(?:\.|%2e)?(?:\/|$)/i.test(value))throw new TypeError(`${label} must omit credentials, query/fragment and traversal`)
 return url.href
}
const OPERATION_FIELDS=['planned_url','recorded_live_url','redirect_url','publication_state','template','work_item_id','implementation_notes','qa_evidence']
export function serializeWebsitePageOperations(value) {
 if(!exact(value,OPERATION_FIELDS) || OPERATION_FIELDS.some(key=>!(key in value)) || !WEBSITE_PUBLICATION_STATES.includes(value.publication_state))throw new TypeError('Complete named website operational fields required; assignment fields belong to canonical work')
 const result={planned_url:serializeWebsitePageUrl(value.planned_url,'Planned URL'),recorded_live_url:serializeWebsitePageUrl(value.recorded_live_url,'Recorded live URL'),redirect_url:serializeWebsitePageUrl(value.redirect_url,'Redirect URL'),publication_state:value.publication_state,template:value.template===null ? null : bounded(value.template,160,'Template'),work_item_id:value.work_item_id===null ? null : id(value.work_item_id,'Canonical Work Item'),implementation_notes:bounded(value.implementation_notes,4000,'Implementation notes',true),qa_evidence:bounded(value.qa_evidence,4000,'QA evidence',true)}
 if(result.publication_state==='published' && !result.recorded_live_url)throw new TypeError('A manually recorded published state needs an exact live URL')
 if(result.redirect_url && !result.recorded_live_url)throw new TypeError('Record the original live URL before its redirect destination')
 return result
}

export function reconcileRegisteredWebsitePageIdentity(page,binding,sourcePage) {
 if(typeof sourcePage.page_key!=='string' || !binding.page_keys?.includes(sourcePage.page_key) || typeof page.initial_path!=='string' || !page.initial_path || page.organization_id!==binding.organization_id || page.project_id!==binding.project_id || page.engagement_id!==binding.engagement_id || page.architecture_artifact_id!==binding.architecture_artifact_id || page.page_key!==sourcePage.page_key)throw new TypeError('A page key cannot silently merge another project, architecture root or legacy identity')
 return {page_id:id(page.id,'Stable registered page'),page_key:page.page_key,source_architecture_version_id:binding.architecture_version_id,source_architecture_checksum:binding.architecture_checksum,source_architecture_approval_id:binding.architecture_approval_id,initial_path:page.initial_path,current_planned_path:sourcePage.path}
}
