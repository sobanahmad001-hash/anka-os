import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import React,{act} from 'react'
import {createRoot} from 'react-dom/client'
import {transformSync} from 'esbuild'
import {mountedEnvironment} from './testSupport/n1bMountedDom.js'
const require=createRequire(import.meta.url),module={exports:{}}
new Function('require','module','exports','React',transformSync(readFileSync(new URL('../components/DescriptionDisclosure.jsx',import.meta.url),'utf8'),{loader:'jsx',format:'cjs',jsxFactory:'React.createElement'}).code)(require,module,module.exports,React)
const Description=module.exports.default
const nodes=n=>[n,...n.childNodes.flatMap(nodes)],props=n=>n?.[Object.keys(n).find(k=>k.startsWith('__reactProps$'))]
async function mount(t,text){
 const env=mountedEnvironment(),names=['document','window','ResizeObserver','IS_REACT_ACT_ENVIRONMENT'],previous=Object.fromEntries(names.map(n=>[n,globalThis[n]]));const observers=[]
 class Observer{constructor(callback){this.callback=callback;observers.push(this)}observe(element){this.element=element}disconnect(){this.disconnected=true}}
 Object.assign(globalThis,{document:env.document,window:env.window,ResizeObserver:Observer,IS_REACT_ACT_ENVIRONMENT:true});const root=createRoot(env.container)
 const render=value=>act(async()=>root.render(React.createElement(Description,{text:value,label:'Project description'})))
 t.after(async()=>{await act(async()=>root.unmount());Object.assign(globalThis,previous)})
 await render(text)
 return {env,render,observers,button:()=>nodes(env.container).find(n=>n.nodeName==='BUTTON'),measure:async(height=300)=>act(async()=>{const o=observers.at(-1);o.element.clientHeight=96;o.element.scrollHeight=height;o.callback()}),toggle:async()=>act(async()=>props(nodes(env.container).find(n=>n.nodeName==='BUTTON')).onClick())}
}
test('actual overflow alone exposes a labeled disclosure and exact full text, then collapse removes its hidden copy',async t=>{
 const text='Original line one\n'+('Unchanged description. '.repeat(100)),ui=await mount(t,text);await ui.measure();assert.equal(props(ui.button())['aria-expanded'],false);const id=props(ui.button())['aria-controls'];assert.ok(id);await ui.toggle();assert.equal(props(ui.button())['aria-expanded'],true);const panel=nodes(ui.env.container).find(n=>props(n)?.id===id);assert.equal(props(panel).hidden,false);assert.equal(panel.textContent,text);assert.equal(props(panel.childNodes[0]).style.whiteSpace,'pre-wrap');await ui.toggle();assert.equal(props(panel).hidden,true);assert.equal(panel.childNodes.length,0)
})
test('empty and short content remain exact and have no unnecessary toggle',async t=>{
 const ui=await mount(t,'');await ui.measure(0);assert.equal(ui.button(),undefined);await ui.render('Short description.');await ui.measure(24);assert.equal(ui.button(),undefined);assert.equal(ui.env.container.textContent,'Short description.')
})
test('resize remeasures the preview and removes a no-longer-needed disclosure',async t=>{
 const ui=await mount(t,'A description that wraps differently by viewport.');await ui.measure();assert.ok(ui.button());await ui.measure(72);assert.equal(ui.button(),undefined)
})
test('replacing content resets expansion and disconnects the previous observer',async t=>{
 const ui=await mount(t,'First record '.repeat(200));await ui.measure();const old=ui.observers.at(-1);await ui.toggle();assert.equal(old.disconnected,true);await ui.render('Second record '.repeat(200));await ui.measure();assert.equal(props(ui.button())['aria-expanded'],false);assert.doesNotMatch(ui.env.container.textContent,/First record/)
})
