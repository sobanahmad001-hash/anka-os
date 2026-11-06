import {validateWebsiteNativeDesign,websiteNativeSnapshotChecksum,validateWebsiteNavigationDestination} from './websiteNativeDesign.js'
const stringify=value=>JSON.stringify(value)
function plain(value,keys,label){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)))throw Error(`Exact ${label} required`)}
function required(value,label,max){if(typeof value!=='string'||!value.trim()||value.length>max)throw Error(`Complete ${label} in Content; it is not truncated or replaced`);return value.trim()}
export function nativeCopyParagraphs(value){
 let remaining=required(value,'page copy',96000),parts=[]
 while(remaining.length){let end=Math.min(3000,remaining.length);if(end<remaining.length&&/[\uD800-\uDBFF]/.test(remaining[end-1]))end--;const piece=remaining.slice(0,end).trim();if(piece)parts.push(piece);remaining=remaining.slice(end)}
 if(parts.length>32)throw Error('Page copy exceeds the bounded preview; resolve it in Content without truncation')
 return parts
}
function writerCopyParagraphs(value){
 if(typeof value!=='string'||!value.trim()||value.length>96000)throw Error('Complete bounded page copy in Content; it is not truncated or replaced')
 const parts=[];let offset=0
 while(offset<value.length){let end=Math.min(offset+3000,value.length);if(end<value.length&&/[\uD800-\uDBFF]/.test(value[end-1]))end--;parts.push(value.slice(offset,end));offset=end}
 return parts
}
// A bounded source format, not a general Markdown/HTML interpreter. Legacy copy
// remains available verbatim; structured layouts must account for every line.
export function nativeWebsiteCopySections(value){
 const copy=required(value,'page copy',96000).replaceAll('\r\n','\n')
 if(!/^## \d+\. /m.test(copy))return null
 const sections=[],keys=new Set()
 let section=null,item=null,body=[],number=0,bodyStarted=false
 function flush(){
  const text=body.join('\n').trim();body=[]
  if(!text)return
  if(!section?.heading)throw Error('Place section copy after its section heading')
  if(item)item.body+=(item.body?'\n\n':'')+text
  else section.paragraphs.push(text)
 }
 for(const raw of copy.split('\n')){
  const line=raw.trim(),outer=line.match(/^## (\d+)\. (.+)$/),anchor=line.match(/^\*Section anchor: `([a-z][a-z0-9_-]{0,63})`\*$/),subheading=line.match(/^### (.+)$/),feature=line.match(/^#### (.+)$/),cta=line.match(/^\*\*(Primary CTA|Secondary CTA|CTA):\*\* \[([^\[\]\n]+)\]\(([^()\s]+)\)$/)
  if(outer){flush();if(section&&!section.heading)throw Error('Every section needs its public heading');if(Number(outer[1])!==++number||number>16)throw Error('Numbered sections must be consecutive and bounded');const key=outer[2].toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');if(!/^[a-z][a-z0-9_-]{0,63}$/.test(key)||keys.has(key)||key==='main')throw Error('Unique section anchors required');keys.add(key);section={key,heading:'',paragraphs:[],items:[],action:null};sections.push(section);item=null;bodyStarted=false;continue}
  if(!line){flush();continue}
  if(!section)throw Error('Numbered page copy must start with its first section')
  if(anchor){if(bodyStarted||section.heading||section.key!==anchor[1])throw Error('Section anchor must match its numbered section');continue}
  if(subheading){flush();if(section.heading||bodyStarted)throw Error('One public heading per section required');section.heading=subheading[1];continue}
  if(feature){flush();if(!section.heading||section.action)throw Error('Feature headings must follow section copy and precede actions');item={title:feature[1],body:''};section.items.push(item);bodyStarted=true;continue}
  if(cta){flush();if(!section.heading)throw Error('Place actions after a section heading');const action={label:cta[2],path:validateWebsiteNavigationDestination(cta[3])},field=cta[1]==='Secondary CTA'?'secondary_action':'action';if(section[field])throw Error('One primary and secondary action per section supported');section[field]=action;item=null;bodyStarted=true;continue}
  // Reject unsupported markup rather than silently dropping/reinterpreting it.
  if(section.action||section.secondary_action||/[<>\[\]`*]|^#{1,6}\s|^[-+>]\s|^\d+\.\s/.test(line))throw Error('Unsupported structured page copy; keep plain paragraphs, headings and explicit CTA lines')
  body.push(raw.trimEnd());bodyStarted=true
 }
 flush()
 if(!sections.length||sections.some(s=>!s.heading||s.items.some(i=>!i.body)))throw Error('Complete section headings and feature copy required')
 return sections
}
export function websiteNativeLayout(context){
 const sections=context?nativeWebsiteCopySections(context.content_page?.draft_copy):null
 return {template:'home',sections:sections?sections.map(s=>({source_key:s.key,component:s.items.length&&s.key!=='faqs'?'feature_grid':'prose',motion:'none',heading:s.heading})):[{source_key:'copy',component:'prose',motion:'none'}],cta_path:''}
}
export async function prepareWebsiteNativeManifest(context,options){
 plain(options,['template','sections','cta_path'],'Website layout options')
 const page=context.content_page
 const writer=page?.source_format==='writer_v2'
 if(Object.hasOwn(page||{},'source_format')&&!writer)throw Error('Unsupported native Content source format')
 required(page?.page_brief,'page brief',128000)
 if(writer){
  if(page.meta_description!==''||page.primary_cta!==null&&(typeof page.primary_cta!=='string'||!page.primary_cta.trim()||page.primary_cta.length>80||page.primary_cta!==page.primary_cta.trim()))throw Error('Writer v2 requires empty SEO summary and exact bounded CTA or null')
 }else required(page?.primary_cta,'primary CTA',240)
 const structured=writer?nativeWebsiteCopySections(page?.draft_copy):options.sections?.some(s=>s.source_key!=='copy')?nativeWebsiteCopySections(page?.draft_copy):null
 if(structured&&options.cta_path&&options.cta_path!==structured[0].action?.path)throw Error('Structured CTA destinations come from exact saved Content')
 if(writer&&!structured&&page.primary_cta===null&&options.cta_path)throw Error('A CTA destination requires an exact saved CTA label')
 const content={title:writer?page.meta_title:required(page?.meta_title,'meta title',240),summary:writer?'':required(page?.meta_description,'meta description',800),sections:structured||[{key:'copy',heading:required(context.page?.title,'page heading',240),paragraphs:writer?writerCopyParagraphs(page?.draft_copy):nativeCopyParagraphs(page?.draft_copy),items:[],action:options.cta_path?{label:required(page?.primary_cta,'primary CTA',80),path:options.cta_path}:null}],...(writer?{format:structured?'writer_v2_numbered':'writer_v2_plain'}:structured?{format:'numbered_sections_v1'}:{})}
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
