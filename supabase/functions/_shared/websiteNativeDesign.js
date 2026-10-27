// Provider-free contract, not authorization, approval, a build runner or publication.
// Existing registered page and immutable source versions remain canonical.
export const WEBSITE_NATIVE_TEMPLATES=Object.freeze(['home','service','location','article','about','contact'])
export const WEBSITE_NATIVE_COMPONENTS=Object.freeze(['prose','feature_grid','call_to_action'])
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const hash=/^[0-9a-f]{64}$/
function exact(value,keys,label){if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))throw new TypeError(`Exact ${label} fields required`)}
function text(value,max,label){if(typeof value!=='string'||!value.trim()||value!==value.trim()||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))throw new TypeError(`Bounded ${label} required`);return value}
function list(value,min,max,label){if(!Array.isArray(value)||value.length<min||value.length>max)throw new TypeError(`Bounded ${label} required`);return value}
function key(value){if(typeof value!=='string'||!/^[a-z][a-z0-9_-]{0,63}$/.test(value))throw new TypeError('Stable local section key required');return value}
function path(value){if(typeof value!=='string'||value.length>240||!(/^(?:\/(?!\/)[a-zA-Z0-9/_-]*|#[a-z][a-z0-9_-]*)$/.test(value))||value.split('/').includes('..'))throw new TypeError('Local site path or section anchor required');return value}
function reference(value){exact(value,['version_id','checksum'],'source reference');if(typeof value.version_id!=='string'||typeof value.checksum!=='string'||!uuid.test(value.version_id)||!hash.test(value.checksum))throw new TypeError('Exact source UUID and checksum required')}
function luminance(color){const values=color.slice(1).match(/../g).map(part=>parseInt(part,16)/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);return values[0]*.2126+values[1]*.7152+values[2]*.0722}
function contrast(a,b){const values=[luminance(a),luminance(b)].sort((x,y)=>y-x);return (values[0]+.05)/(values[1]+.05)}
function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value)}
export async function websiteNativeSnapshotChecksum(value){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)));return [...new Uint8Array(bytes)].map(n=>n.toString(16).padStart(2,'0')).join('')}
const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;')

export function validateWebsiteNativeSite(site){
 exact(site,['title','language','description','palette','navigation','footer'],'site system')
 text(site.title,120,'site title');text(site.description,300,'site description');text(site.footer,300,'footer')
 if(!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(site.language))throw new TypeError('Supported language tag required')
 exact(site.palette,['background','surface','ink','accent'],'site palette')
 for(const color of Object.values(site.palette))if(!/^#[0-9a-f]{6}$/i.test(color))throw new TypeError('Six-digit palette colors required')
 const palette=site.palette
 if(contrast(palette.ink,palette.background)<4.5||contrast(palette.ink,palette.surface)<4.5||contrast(palette.accent,palette.background)<4.5)throw new TypeError('Readable text and link contrast required')
 list(site.navigation,1,8,'navigation').forEach(item=>{exact(item,['label','path'],'navigation item');text(item.label,60,'navigation label');path(item.path)})
 return structuredClone(site)
}

export function validateWebsiteNativeDesign(value){
 exact(value,['schema_version','scope','sources','snapshot_checksums','site','content','layout'],'Website design')
 if(value.schema_version!==1)throw new TypeError('Unsupported Website design schema')
 exact(value.scope,['organization_id','project_id','engagement_id','page_id','page_key'],'page scope')
 for(const name of ['organization_id','project_id','engagement_id','page_id'])if(!uuid.test(value.scope[name]))throw new TypeError('Existing exact project page identity required')
 text(value.scope.page_key,1208,'registered page key')
 exact(value.sources,['architecture','content','brief','site_system'],'source bindings')
 for(const ref of Object.values(value.sources))reference(ref)
 exact(value.snapshot_checksums,['content','site_system'],'normalized snapshot checksums')
 for(const sha of Object.values(value.snapshot_checksums))if(typeof sha!=='string'||!hash.test(sha))throw new TypeError('Exact normalized snapshot checksum required')
 validateWebsiteNativeSite(value.site)
 exact(value.content,['title','summary','sections'],'page content')
 text(value.content.title,240,'page title');text(value.content.summary,800,'page summary')
 const sections=new Map()
 list(value.content.sections,1,16,'content sections').forEach(section=>{
  exact(section,['key','heading','paragraphs','items','action'],'content section');key(section.key);text(section.heading,240,'section heading')
  if(sections.has(section.key))throw new TypeError('Duplicate content section')
  list(section.paragraphs,0,32,'paragraphs').forEach(p=>text(p,3000,'paragraph'))
  list(section.items,0,12,'feature items').forEach(item=>{exact(item,['title','body'],'feature');text(item.title,100,'feature title');text(item.body,800,'feature body')})
  if(section.action!==null){exact(section.action,['label','path'],'action');text(section.action.label,80,'action label');path(section.action.path)}
  sections.set(section.key,section)
 })
 exact(value.layout,['template','sections'],'page layout')
 if(!WEBSITE_NATIVE_TEMPLATES.includes(value.layout.template))throw new TypeError('Unsupported Website template; dynamic pages require their own model')
 const used=new Set()
 list(value.layout.sections,1,16,'layout sections').forEach(section=>{
  exact(section,['source_key','component','motion',...(Object.hasOwn(section,'heading')?['heading']:[])],'layout section');if(Object.hasOwn(section,'heading'))text(section.heading,240,'layout heading');key(section.source_key)
  if(!sections.has(section.source_key)||used.has(section.source_key))throw new TypeError('One exact content binding per section required')
  used.add(section.source_key)
  if(!WEBSITE_NATIVE_COMPONENTS.includes(section.component)||!['none','reveal'].includes(section.motion))throw new TypeError('Unsupported component or motion; arbitrary code is not accepted')
  const content=sections.get(section.source_key)
  if(section.component==='feature_grid'&&!content.items.length&&!content.paragraphs.length||section.component==='call_to_action'&&!content.action)throw new TypeError('Component needs its actual content')
 })
 if(used.size!==sections.size)throw new TypeError('Every content section must be accounted for; no silent omission')
 const anchors=new Set(['main',...sections.keys()])
 for(const link of [...value.site.navigation,...value.content.sections.map(s=>s.action).filter(Boolean)])if(link.path.startsWith('#')&&!anchors.has(link.path.slice(1)))throw new TypeError('Anchor target does not exist in this page')
 if(new TextEncoder().encode(JSON.stringify(value)).length>128000)throw new TypeError('Website design exceeds bounded input size')
 return structuredClone(value)
}

export function changedWebsiteNativeSources(design,current){
 validateWebsiteNativeDesign(design);exact(current,Object.keys(design.sources),'current sources')
 return Object.keys(design.sources).filter(name=>{reference(current[name]);return canonical(current[name])!==canonical(design.sources[name])})
}
export function assertWebsiteNativeContext(design,context){
 validateWebsiteNativeDesign(design);exact(context,['scope','sources'],'resolved source context')
 if(canonical(design.scope)!==canonical(context.scope)||canonical(design.sources)!==canonical(context.sources))throw new TypeError('Resolved project/page or exact source versions changed')
 // The caller must resolve this context with the existing authorized repositories.
 // Equality here never grants membership, source consent or business approval.
 return true
}
const block=(name,html,attrs={})=>`<!-- wp:${name}${Object.keys(attrs).length?' '+JSON.stringify(attrs):''} -->${html}<!-- /wp:${name} -->`
const paragraph=p=>block('paragraph',`<p>${esc(p)}</p>`)
const heading=(p,level)=>block('heading',`<h${level} class="wp-block-heading">${esc(p)}</h${level}>`,{level})
const button=action=>block('buttons',`<div class="wp-block-buttons">${block('button',`<div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="${esc(action.path)}">${esc(action.label)}</a></div>`)}</div>`)
function bodyBlocks(value){
 const sections=new Map(value.content.sections.map(s=>[s.key,s]))
 return heading(value.content.title,1)+paragraph(value.content.summary)+value.layout.sections.map(layout=>{
  const s=sections.get(layout.source_key),items=s.items.length?s.items.map(item=>heading(item.title,3)+paragraph(item.body)):layout.component==='feature_grid'?s.paragraphs.map(paragraph):[],features=layout.component==='feature_grid'?block('columns',`<div class="wp-block-columns">${items.map(html=>block('column',`<div class="wp-block-column">${html}</div>`)).join('')}</div>`):items.join(''),inner=heading(layout.heading||s.heading,2)+(layout.component==='feature_grid'?'':s.paragraphs.map(paragraph).join(''))+features+(s.action?button(s.action):'')
  return block('group',`<div id="${esc(s.key)}" class="wp-block-group anka-section anka-${layout.component}${layout.motion==='reveal'?' anka-reveal':''}">${inner}</div>`,{anchor:s.key,className:`anka-section anka-${layout.component}${layout.motion==='reveal'?' anka-reveal':''}`})
 }).join('')
}
export async function compileWebsiteNativeDesign(input){
 const value=validateWebsiteNativeDesign(input)
 if(await websiteNativeSnapshotChecksum(value.content)!==value.snapshot_checksums.content||await websiteNativeSnapshotChecksum(value.site)!==value.snapshot_checksums.site_system)throw new TypeError('Content or site system differs from its exact pinned checksum')
 const p=value.site.palette
 const css=`:root{--bg:${p.background};--surface:${p.surface};--ink:${p.ink};--accent:${p.accent}}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:18px/1.65 system-ui,sans-serif;overflow-wrap:anywhere}header,main,footer{max-width:1120px;margin:auto;padding:32px}header{display:flex;align-items:center;justify-content:space-between;gap:24px;flex-wrap:wrap}nav{display:flex;gap:20px;flex-wrap:wrap}a{color:var(--accent);text-underline-offset:5px}a:focus-visible{outline:3px solid var(--accent);outline-offset:5px}.skip{position:absolute;top:-100px}.skip:focus{top:8px;background:var(--surface);padding:8px;z-index:2}h1{font-size:clamp(2.5rem,6vw,5rem);line-height:1.05;max-width:15ch;letter-spacing:-.035em}h2{font-size:clamp(1.6rem,3vw,2.4rem);line-height:1.2}h3{font-size:1.1rem}p{max-width:70ch;white-space:pre-wrap}.anka-section{padding:36px 0;border-top:1px solid currentColor;margin-top:32px}.wp-block-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}.anka-feature_grid{background:var(--surface);padding:28px;border-radius:20px}.wp-block-button__link{display:inline-block;border-radius:999px;padding:12px 24px;background:var(--ink);color:var(--bg);text-decoration:none}.anka-reveal{animation:anka-reveal .35s ease-out}@keyframes anka-reveal{from{transform:translateY(8px)}to{transform:none}}@media(max-width:600px){.wp-block-columns{grid-template-columns:minmax(0,1fr)}header,main,footer{padding:24px}nav{gap:12px}body{font-size:16px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}`
 const navigation=`<nav aria-label="Primary">${value.site.navigation.map(link=>`<a href="${esc(link.path)}">${esc(link.label)}</a>`).join('')}</nav>`
 const header=block('group',`<header class="wp-block-group">${paragraph(value.site.title)}${block('html',navigation)}</header>`,{tagName:'header'})
 const footer=block('group',`<footer class="wp-block-group">${paragraph(value.site.footer)}</footer>`,{tagName:'footer'})
 const blocks=bodyBlocks(value),main=block('group',`<main id="main" class="wp-block-group">${blocks}</main>`,{tagName:'main',anchor:'main'})
 const csp="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; script-src 'none'; form-action 'none'; base-uri 'none'"
 const preview=`<!doctype html><html lang="${esc(value.site.language)}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>${esc(value.content.title)}</title><meta name="description" content="${esc(value.content.summary)}"><style>${css}</style></head><body><a class="skip" href="#main">Skip to content</a>${header}${main}${footer}</body></html>`
 const templateName=`anka-${value.layout.template}`
 const theme={version:3,$schema:'https://schemas.wp.org/wp/6.6/theme.json',settings:{layout:{contentSize:'1120px',wideSize:'1280px'},color:{palette:Object.entries(p).map(([slug,color])=>({slug,name:slug,color}))}},styles:{color:{background:p.background,text:p.ink},typography:{fontFamily:'system-ui, sans-serif'}},customTemplates:[{name:templateName,title:`Anka ${value.layout.template}`,postTypes:['page']}],templateParts:[{name:'header',title:'Site header',area:'header'},{name:'footer',title:'Site footer',area:'footer'}]}
 theme.styles.css=css
 const part=slug=>`<!-- wp:template-part {"slug":"${slug}","area":"${slug}"} /-->`
 const files={'style.css':`/*\nTheme Name: Anka Native Foundation\nVersion: 0.1.0\nRequires at least: 6.6\nText Domain: anka-native\n*/\n${css}`,'theme.json':JSON.stringify(theme,null,2),'templates/index.html':part('header')+'<!-- wp:post-content /-->'+part('footer'),[`templates/${templateName}.html`]:part('header')+main+part('footer'),'parts/header.html':header,'parts/footer.html':footer}
 // Package staging is not provided here. A worker must still validate/install/render it.
 return {compiler_version:2,scope:value.scope,sources:value.sources,snapshot_checksums:value.snapshot_checksums,input_checksum:await websiteNativeSnapshotChecksum(value),files,files_checksum:await websiteNativeSnapshotChecksum(files),blocks,preview:preview.replace(/<a href="(\/[^"]*)"/g,'<a target="_top" href="$1"'),capability:'provider_free_source_package',live:false}
}
