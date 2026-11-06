import {WEBSITE_NATIVE_TEMPLATES} from '../data/websiteNativeDesign.js'

export default function DesignWebsiteLayoutControls({context,layout,locked,onChange,children}){
 const editLayout=onChange
 return (
  <fieldset disabled={locked}><legend>Page layout</legend><label>Page template<select aria-label="Page template" value={layout.template} onChange={e=>editLayout({...layout,template:e.target.value})}>{WEBSITE_NATIVE_TEMPLATES.map(t=><option key={t}>{t}</option>)}</select></label>
   {layout.sections.map((section,i)=><div key={section.source_key}><label>Content layout<select aria-label="Content layout" value={section.component} onChange={e=>editLayout({...layout,sections:layout.sections.map((s,n)=>n===i?{...s,component:e.target.value}:s)})}><option value="prose">Editorial content</option><option value="feature_grid">Content columns</option><option value="call_to_action">Call to action</option></select></label><label>Section heading<input value={section.heading??context.page.title} onChange={e=>editLayout({...layout,sections:layout.sections.map((s,n)=>n===i?{...s,heading:e.target.value}:s)})}/></label><label>Motion<select aria-label="Motion" value={section.motion} onChange={e=>editLayout({...layout,sections:layout.sections.map((s,n)=>n===i?{...s,motion:e.target.value}:s)})}><option value="none">None</option><option value="reveal">Gentle reveal · respects reduced motion</option></select></label></div>)}
   <label>CTA destination (optional local path, anchor or HTTPS URL)<input disabled={layout.sections.some(s=>s.source_key!=='copy')||(context.content_page?.source_format==='writer_v2'&&!context.content_page.primary_cta)} value={layout.cta_path} placeholder="https://ankasphere.com/contact-anka-sphere/" onChange={e=>editLayout({...layout,cta_path:e.target.value})}/></label><p>HTTPS links are navigation destinations; they do not fetch or import content. Numbered section headings, anchors and CTA destinations come from the selected saved Content. Page copy and metadata stay in Content. Layout changes do not overwrite them.</p>
   {children}
  </fieldset>
 )
}
