import test from 'node:test'
import assert from 'node:assert/strict'
import {importPreview,approvedRows,sheetKeywords} from './websiteImport.js'
import {discover} from '../../supabase/functions/website-discovery/discover.js'
const origin='https://fixture.example',url=origin+'/changed/'
const meta={url,title:'New source title',h1:'Heading',canonical:url,description:'Description',status:200,wpId:11}
test('stable WordPress identity moves imported URL while retaining manual title and assignments',()=>{
 const page={id:'local',revision:3,title:'Original title',path:'/old/',url:origin+'/old/',mode:'targets',targets:[{query:'t',locale:'en',role:'primary',intent:'hire'}]}
 const old={page_id:'local',origin,wp_id:11,manage_title:false,manage_url:true,manage_path:true,meta:{...meta,title:page.title,url:page.url}}
 const sheet={rows:[{row:1,cells:['URL','keyword','role','intent','locale']},{row:2,cells:[url,'t','primary','hire','en']},{row:3,cells:[url,'u','supporting','visit','en']},{row:4,cells:[origin+'/missing','a','primary','hire','en']}]}
 const preview=importPreview({origin,pages:[meta]},[page],[old],sheetKeywords(sheet))
 const [v]=approvedRows(preview.candidates);assert.equal(v.id,'local');assert.equal(v.title,page.title);assert.equal(v.url,url);assert.equal(v.path,'/changed/');assert.deepEqual(v.additions.map(k=>k.query),['u']);assert.equal(preview.warnings.length,1)
 const repeated=importPreview({origin,pages:[meta]},[{...page,url,path:v.path,targets:[...page.targets,...v.additions]}],[{...old,meta}],sheetKeywords(sheet))
 assert.deepEqual(approvedRows(repeated.candidates),[])
})
test('conflicting stable ID and page URL are withheld',()=>{
 const pages=[{id:'1',path:'/old',url:origin+'/old',mode:'none',targets:[]},{id:'2',path:'/changed/',url,mode:'none',targets:[]}]
 const p=importPreview({origin,pages:[meta]},pages,[{origin,page_id:'1',wp_id:11,meta:{...meta,url:pages[0].url}}],[])
 assert.equal(p.candidates[0].state,'ambiguous');assert.equal(approvedRows(p.candidates).length,0)
})
test('sitemap indexes, internal links and stable public WordPress IDs are discovered under bounds',async()=>{
 const seen=[];const bodies={'/robots.txt':'User-agent: *\nDisallow: /private','/sitemap.xml':'<sitemapindex><loc>'+origin+'/child.xml</loc></sitemapindex>','/child.xml':'<urlset><loc>'+origin+'/mapped</loc></urlset>','/':'<title>Home</title><a href="/linked">Linked</a><a href="/private">Skip</a><a href="https://external.test">External</a>','/mapped':'<title>Mapped</title>','/linked':'<h1>Linked</h1><meta content="Summary" name="description"><link rel="canonical" href="/linked">'}
 const r=await discover(origin,async u=>{seen.push(u.href);assert.equal(u.origin,origin);if(u.pathname==='/wp-json/wp/v2/pages')return {status:200,text:JSON.stringify([{id:12,link:origin+'/linked'}]),type:'application/json'};return {status:bodies[u.pathname]?200:404,text:bodies[u.pathname]||'',type:u.pathname.endsWith('.xml')?'application/xml':'text/html'}})
 assert.equal(r.pages.length,3);const linked=r.pages.find(p=>p.wpId===12);assert.equal(linked.description,'Summary');assert.equal(linked.h1,'Linked');assert.equal(linked.canonical,linked.url);assert(!seen.includes(origin+'/private'));assert(seen.length<=48)
})
