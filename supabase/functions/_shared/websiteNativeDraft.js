import {validateWebsiteNativeDesign,websiteNativeSnapshotChecksum} from './websiteNativeDesign.js'
const stringify=value=>JSON.stringify(value)
function plain(value,keys,label){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)))throw Error(`Exact ${label} required`)}
function required(value,label,max){if(typeof value!=='string'||!value.trim()||value.length>max)throw Error(`Complete ${label} in Content; it is not truncated or replaced`);return value.trim()}
export function nativeCopyParagraphs(value){
 let remaining=required(value,'page copy',96000),parts=[]
 while(remaining.length){let end=Math.min(3000,remaining.length);if(end<remaining.length&&/[\uD800-\uDBFF]/.test(remaining[end-1]))end--;const piece=remaining.slice(0,end).trim();if(piece)parts.push(piece);remaining=remaining.slice(end)}
 if(parts.length>32)throw Error('Page copy exceeds the bounded preview; resolve it in Content without truncation')
 return parts
}
export async function prepareWebsiteNativeManifest(context,options){
 plain(options,['template','sections','cta_path'],'Website layout options')
 const page=context.content_page
 required(page?.page_brief,'page brief',128000);required(page?.primary_cta,'primary CTA',240)
 const content={title:required(page?.meta_title,'meta title',240),summary:required(page?.meta_description,'meta description',800),sections:[{key:'copy',heading:required(context.page?.title,'page heading',240),paragraphs:nativeCopyParagraphs(page?.draft_copy),items:[],action:options.cta_path?{label:required(page?.primary_cta,'primary CTA',80),path:options.cta_path}:null}]}
 const site=context.site_version?.site
 const value={schema_version:1,scope:context.scope,sources:{architecture:{version_id:context.architecture.artifact_version_id,checksum:context.architecture.content_checksum},content:{version_id:context.content_version.id,checksum:context.content_version.content_checksum},brief:{version_id:context.brief_version.id,checksum:context.brief_version.content_checksum},site_system:{version_id:context.site_version.id,checksum:context.site_version.request_sha256}},snapshot_checksums:{content:await websiteNativeSnapshotChecksum(content),site_system:await websiteNativeSnapshotChecksum(site)},site,content,layout:{template:options.template,sections:options.sections}}
 return validateWebsiteNativeDesign(value)
}
export async function verifyWebsiteNativeManifest(context,input){
 const value=validateWebsiteNativeDesign(input)
 const expected=await prepareWebsiteNativeManifest(context,{template:value.layout.template,sections:value.layout.sections,cta_path:value.content.sections[0]?.action?.path||''})
 if(await websiteNativeSnapshotChecksum(expected)!==await websiteNativeSnapshotChecksum(value))throw Error('Design differs from the selected exact source versions; refresh and review')
 return expected
}
export function websiteLayoutPrompt(bindingKey,layout){
 return `Propose a Website layout for the selected page. Keep the source copy unchanged. Return one fenced JSON object with schema_version:1, binding_key:${stringify(bindingKey)}, template:${stringify(layout.template)}, sections:${stringify(layout.sections)}. Each section must keep its source_key. Allowed component: prose, feature_grid, call_to_action (only with an existing CTA). Allowed motion: none or reveal. An optional heading may refine the section heading. No HTML, JavaScript, URLs, publication, generation or approval claims. I will review any proposal before Apply.`
}
export function readWebsiteLayoutProposal(body,bindingKey,sourceKeys){
 if(typeof body!=='string'||body.length>24000)throw Error('Choose a bounded saved Chat reply')
 const fence=body.match(/```(?:json|anka_website_layout)?\s*([\s\S]*?)```/i)
 let value;try{value=JSON.parse(fence?fence[1]:body)}catch{throw Error('This reply does not contain a Website layout proposal')}
 plain(value,['schema_version','binding_key','template','sections'],'Website layout proposal')
 if(value.schema_version!==1||value.binding_key!==bindingKey||!Array.isArray(value.sections)||value.sections.length!==sourceKeys.length||new Set(value.sections.map(s=>s.source_key)).size!==sourceKeys.length||value.sections.some(s=>!sourceKeys.includes(s.source_key)))throw Error('Proposal belongs to different sources or omits/duplicates a section')
 return {template:value.template,sections:value.sections}
}
