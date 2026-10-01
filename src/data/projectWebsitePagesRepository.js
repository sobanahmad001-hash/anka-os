import {serializeWebsitePageOperations,WEBSITE_PUBLICATION_STATES} from './projectWebsitePageContracts.js'
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const id=(value,label)=>{if(typeof value!=='string' || !UUID.test(value))throw new TypeError(`${label} must be an exact UUID`);return value}
const scope=value=>({p_organization_id:id(value.organizationId,'Organization'),p_project_id:id(value.projectId,'Project')})
const version=value=>({p_architecture_version_id:id(value.architectureVersionId,'Approved architecture version')})
const page=value=>({p_page_id:id(value.pageId,'Registered page')})
const request=value=>({p_request_id:id(value.requestId,'Operation')})
const number=(value,label)=>{if(!Number.isSafeInteger(value) || value<0)throw new TypeError(`${label} must be a current nonnegative integer`);return value}
const paging=({offset=0,limit=25})=>{number(offset,'Offset');number(limit,'Limit');if(offset>10000 || limit<1 || limit>100)throw new TypeError('Choose bounded paging');return {p_offset:offset,p_limit:limit}}
const keys=value=>{if(!Array.isArray(value) || value.length<1 || value.length>150 || new Set(value).size!==value.length || value.some(key=>typeof key!=='string' || !key || key!==key.trim() || key.length>1208 || /[\u0000-\u001f\u007f]/.test(key)))throw new TypeError('Review 1–150 distinct exact page keys');return [...value]}
const confirmed=value=>{if(value.confirmed!==true)throw new TypeError('Review and confirm this exact page operation')}
async function result(query,signal){if(signal && query.abortSignal)query=query.abortSignal(signal);const {data,error}=await query;if(error)throw Object.assign(new Error(error.message),{code:error.code,knownRollback:['22023','42501','40001','55000','23505'].includes(error.code)});return data}
// Server RPCs independently recheck current authority, exact approved source and revision.
// No table mutations, canonical work creation, assignments, provider or publishing calls.
export function createProjectWebsitePagesRepository(client){
 if(!client?.rpc)throw new TypeError('A Supabase-compatible RPC client is required')
 const call=(name,args,options)=>result(client.rpc(name,args),options?.signal)
 return Object.freeze({
  list(value,options){const {search='',publicationState=null,parentPageKey=null}=value;if(typeof search!=='string' || search.length>240 || (publicationState!==null && !WEBSITE_PUBLICATION_STATES.includes(publicationState)) || (parentPageKey!==null && (typeof parentPageKey!=='string' || !parentPageKey || parentPageKey.length>1208)))throw new TypeError('Choose explicit bounded page filters');return call('list_project_website_pages',{...scope(value),...version(value),...paging(value),p_search:search,p_publication_state:publicationState,p_parent_page_key:parentPageKey},options)},
  preview(value,options){return call('preview_project_website_pages',{...scope(value),...version(value),p_page_keys:keys(value.pageKeys)},options)},
  register(value,options){confirmed(value);if(!/^[0-9a-f]{64}$/.test(value.reviewSha256 || ''))throw new TypeError('Exact server review checksum required');return call('register_project_website_pages',{...scope(value),...version(value),...request(value),p_page_keys:keys(value.pageKeys),p_review_sha256:value.reviewSha256},options)},
  saveOperations(value,options){confirmed(value);return call('save_project_website_page_operations',{...scope(value),...page(value),...version(value),...request(value),p_expected_revision:number(value.expectedRevision,'Expected page revision'),p_operations:serializeWebsitePageOperations(value.operations)},options)},
  linkSeo(value,options){confirmed(value);return call('link_project_website_page_seo',{...scope(value),...page(value),...version(value),...request(value),p_tracked_page_id:value.trackedPageId===null ? null : id(value.trackedPageId,'Explicit SEO page'),p_expected_link_number:number(value.expectedLinkNumber,'Expected SEO link number')},options)},
  editor(value,options){const {query='',workOffset=0,seoOffset=0,limit=25}=value;if(typeof query!=='string' || query.length>120 || number(workOffset,'Work lookup offset')>10000 || number(seoOffset,'SEO lookup offset')>10000 || number(limit,'Lookup limit')<1 || limit>50)throw new TypeError('Choose bounded editor lookups');return call('get_project_website_page_editor',{...scope(value),...page(value),...version(value),p_query:query,p_work_offset:workOffset,p_seo_offset:seoOffset,p_limit:limit},options)},
  history(value,options){return call('get_project_website_page_history',{...scope(value),...page(value),...paging(value)},options)},
  recover(value,options){return call('get_project_website_page_operation',{...scope(value),...request(value)},options)},
 })
}
