import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { mountedEnvironment, elements } from './testSupport/designVideoDom.js'
const props = node => node[Object.keys(node).find(key => key.startsWith('__reactProps$'))]
const button = (container, label) => elements(container, 'button').find(node => node.textContent.includes(label))
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => {resolve=yes;reject=no}); return {promise,resolve,reject} }
test('mounted private video promotion stays exact and unapproved', async t => {
  const server = await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent'})
  t.after(()=>server.close())
  const {default:Component} = await server.ssrLoadModule('/src/components/DesignVideoPromotion.jsx')
  async function mount(t) {
    const env=mountedEnvironment()
    const keys=['document','window','Event','Node','HTMLElement','IS_REACT_ACT_ENVIRONMENT','fetch']
    const previous=Object.fromEntries(keys.map(key=>[key,globalThis[key]]))
    Object.assign(globalThis,{document:env.document,window:env.window,Event:env.window.Event,Node:env.window.Node,
      HTMLElement:env.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true,fetch:()=>{throw new Error('Network forbidden')}})
    const pending=deferred();const calls=[];let failures=0
    const studio={listEngagements:async()=>[{id:'project',name:'Project',engagement_services:[{id:'service',status:'active',
      service_catalog:{department_id:'design',is_active:true,name:'Design'}}]}],
      previewVideoPromotion:async input=>({...input,checksum:'exact',name:'Saved video',mime_type:'video/mp4',rights_notes:''}),
      promotePrivateVideo:input=>{calls.push(input);if(failures++===0)return pending.promise;return Promise.resolve({version_id:'saved-version',status:'draft'})}}
    const root=createRoot(env.container)
    t.after(async()=>{await act(async()=>root.unmount());Object.assign(globalThis,previous)})
    const render=key=>act(async()=>root.render(createElement(Component,{key,studio,jobId:key})))
    await render('job-a')
    async function preview() {
      await act(async()=>props(elements(env.container,'select')[0]).onChange({target:{value:'project:service'}}))
      await act(async()=>props(button(env.container,'Preview draft copy')).onClick())
    }
    return {env,pending,calls,render,preview}
  }
  await t.test('double click issues one operation; uncertain response retries same key and context',async t=>{
    const m=await mount(t);await m.preview()
    const confirm=props(button(m.env.container,'Confirm unapproved draft copy')).onClick
    await act(async()=>{void confirm();void confirm()})
    assert.equal(m.calls.length,1);assert.equal(props(elements(m.env.container,'select')[0]).disabled,true)
    await act(async()=>m.pending.reject(new Error('lost response')))
    await act(async()=>props(button(m.env.container,'Retry same draft copy')).onClick())
    assert.deepEqual(m.calls[0],m.calls[1]);assert.ok(m.calls[0].operation_key)
    assert.equal(m.calls[0].expected_checksum,'exact')
    assert.match(m.env.container.textContent,/Unapproved project draft saved/)
    assert.match(m.env.container.textContent,/saved-version/)
  })
  await t.test('context remount ignores completion from previous private job',async t=>{
    const m=await mount(t);await m.preview()
    await act(async()=>{void props(button(m.env.container,'Confirm unapproved draft copy')).onClick()})
    await m.render('job-b')
    await act(async()=>m.pending.resolve({version_id:'old-version',status:'draft'}))
    assert.doesNotMatch(m.env.container.textContent,/old-version|Unapproved project draft saved/)
    assert.equal(props(elements(m.env.container,'select')[0]).disabled,false)
  })
  await t.test('brief selector saves exact typed image and video versions without adopting latest',async t=>{
    const {default:Brief}=await server.ssrLoadModule('/src/components/DesignCreativeBriefWorkspace.jsx')
    const env=mountedEnvironment()
    const keys=['document','window','Event','Node','HTMLElement','IS_REACT_ACT_ENVIRONMENT']
    const previous=Object.fromEntries(keys.map(key=>[key,globalThis[key]]))
    Object.assign(globalThis,{document:env.document,window:env.window,Event:env.window.Event,Node:env.window.Node,HTMLElement:env.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})
    const root=createRoot(env.container);t.after(async()=>{await act(async()=>root.unmount());Object.assign(globalThis,previous)})
    const calls=[]
    const workspace={engagement:{id:'project',organization_id:'org',brand_id:'brand'},
      designAssets:[{id:'image',name:'Saved image'},{id:'video',name:'Saved video'}],
      designAssetVersions:[{id:'image-v1',asset_id:'image',version_number:1,mime_type:'image/png'},
        {id:'image-v2',asset_id:'image',version_number:2,mime_type:'image/png'},
        {id:'video-v1',asset_id:'video',version_number:1,mime_type:'video/mp4'}]}
    await act(async()=>root.render(createElement(Brief,{workspace,activeServiceId:'service',canSave:true,onSave:async input=>{calls.push(input);return false}})))
    await act(async()=>props(elements(env.container,'input').find(node=>props(node).required)).onChange({target:{value:'Exact references'}}))
    const checkboxes=elements(env.container,'input').filter(node=>props(node).type==='checkbox')
    await act(async()=>{props(checkboxes[0]).onChange();props(checkboxes[2]).onChange()})
    await act(async()=>props(elements(env.container,'form')[0]).onSubmit({preventDefault(){}}))
    await act(async()=>props(elements(env.container,'form')[0]).onSubmit({preventDefault(){}}))
    assert.deepEqual(calls[0].content.media_references,[{kind:'design_asset_version',id:'image-v1'},{kind:'design_asset_version',id:'video-v1'}])
    assert.deepEqual(calls[0].source_version_ids,[])
    assert.equal(calls[0].operation_key,calls[1].operation_key)
  })
  await t.test('saved-video version reader renders video, preserving image reader',async()=>{
    const {default:Browser}=await server.ssrLoadModule('/src/components/DesignAssetVersionBrowser.jsx')
    const now=Date.now(), origin='https://storage.example'
    const row={assetId:'asset',mediaType:'video',recorded:{name:'Saved video'},assetVersions:[{
      id:'v1',version_number:1,mime_type:'video/mp4',signed_url:`${origin}/storage/v1/object/sign/design-generated-video/file.mp4?token=offline`}]}
    const options={issuedAt:now,now,expiresInSeconds:300,trustedOrigin:origin}
    const video=renderToStaticMarkup(createElement(Browser,{row,contextKey:'scope',accessOptions:options}))
    assert.match(video,/<video/);assert.doesNotMatch(video,/<img/)
    const image=renderToStaticMarkup(createElement(Browser,{row:{...row,mediaType:'image',assetVersions:[...row.assetVersions,{...row.assetVersions[0],id:'v2',version_number:2}]},contextKey:'scope',accessOptions:options}))
    assert.match(image,/<img/);assert.doesNotMatch(image,/<video/)
  })
})
