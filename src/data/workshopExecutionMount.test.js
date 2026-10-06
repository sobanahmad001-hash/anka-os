import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'

class TestEvent {
  constructor(type, options = {}) {
    this.type = type
    this.bubbles = options.bubbles !== false
    this.cancelable = true
    this.defaultPrevented = false
    this.propagationStopped = false
    Object.assign(this, options)
  }
  preventDefault() { this.defaultPrevented = true }
  stopPropagation() { this.propagationStopped = true }
}

class TestNode {
  constructor(nodeType, nodeName, ownerDocument = null) {
    this.nodeType = nodeType
    this.nodeName = nodeName
    this.ownerDocument = ownerDocument
    this.parentNode = null
    this.childNodes = []
    this.listeners = new Map()
  }
  appendChild(node) { node.parentNode = this; this.childNodes.push(node); return node }
  insertBefore(node, before) {
    const index = this.childNodes.indexOf(before)
    if (index < 0) return this.appendChild(node)
    node.parentNode = this
    this.childNodes.splice(index, 0, node)
    return node
  }
  removeChild(node) { const index = this.childNodes.indexOf(node); if (index >= 0) this.childNodes.splice(index, 1); if (node) node.parentNode = null; return node }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }
  removeEventListener(type, listener) {
    const listeners = this.listeners.get(type) || []
    this.listeners.set(type, listeners.filter(item => item !== listener))
  }
  dispatchEvent(event) {
    Object.defineProperty(event, 'target', { configurable: true, value: this })
    let node = this
    while (node) {
      Object.defineProperty(event, 'currentTarget', { configurable: true, value: node })
      for (const listener of node.listeners.get(event.type) || []) listener.call(node, event)
      if (!event.bubbles || event.propagationStopped) break
      node = node.parentNode
    }
    return !event.defaultPrevented
  }
  contains(node) { return node === this || this.childNodes.some((child) => child.contains?.(node)) }
  get firstChild() { return this.childNodes[0] || null }
  get lastChild() { return this.childNodes.at(-1) || null }
  get nextSibling() { if (!this.parentNode) return null; return this.parentNode.childNodes[this.parentNode.childNodes.indexOf(this) + 1] || null }
  get textContent() { return this.nodeType === 3 ? this.data : this.childNodes.map((node) => node.textContent).join('') }
  set textContent(value) {
    if (this.nodeType === 3) {
      this.data = String(value)
    } else {
      this.childNodes = []
      if (value !== '') this.appendChild(this.ownerDocument.createTextNode(String(value)))
    }
  }
}

class TestElement extends TestNode {
  constructor(tagName, ownerDocument, namespaceURI = 'http://www.w3.org/1999/xhtml') {
    super(1, tagName.toUpperCase(), ownerDocument)
    this.tagName = this.nodeName
    this.namespaceURI = namespaceURI
    this.attributes = new Map()
    this.style = {
      setProperty(name, value) { this[name] = value },
      removeProperty(name) { delete this[name] },
    }
    this._value = ''
    this.disabled = false
    this.checked = false
    this.selected = false
    this.type = ''
  }
  get options() { return this.tagName === 'SELECT' ? this.childNodes.filter((node) => node.tagName === 'OPTION') : undefined }
  get value() { return this.tagName === 'SELECT' ? this.options.find((option) => option.selected)?.value ?? this._value : this._value }
  set value(value) {
    this._value = String(value)
    if (this.tagName === 'SELECT') {
      for (const option of this.options) option.selected = option.value === this._value
    }
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value))
    if (name.toLowerCase() === 'value') this.value = String(value)
    if (name.toLowerCase() === 'type') this.type = String(value)
    if (name.toLowerCase() === 'disabled') this.disabled = true
    if (name === 'checked') this.checked = true
    if (name === 'selected') this.selected = true
  }
  getAttribute(name) { return this.attributes.get(name) ?? null }
  removeAttribute(name) { this.attributes.delete(name); if (name === 'disabled') this.disabled = false; if (name === 'checked') this.checked = false; if (name === 'selected') this.selected = false }
  hasAttribute(name) { return this.attributes.has(name) }
  focus() { this.ownerDocument.activeElement = this }
}

class TestText extends TestNode {
  constructor(data, ownerDocument) { super(3, '#text', ownerDocument); this.data = String(data) }
  get nodeValue() { return this.data }
  set nodeValue(value) { this.data = String(value) }
}

class TestDocument extends TestNode {
  constructor() {
    super(9, '#document')
    this.ownerDocument = this
    this.defaultView = null
    this.documentElement = new TestElement('html', this)
    this.body = new TestElement('body', this)
    this.documentElement.appendChild(this.body)
    this.appendChild(this.documentElement)
    this.activeElement = this.body
    this.oninput = null
  }
  createElement(tagName) { return new TestElement(tagName, this) }
  createElementNS(namespaceURI, tagName) { return new TestElement(tagName, this, namespaceURI) }
  createTextNode(data) { return new TestText(data, this) }
}

function mountedEnvironment() {
  const document = new TestDocument()
  const window = {
    document,
    addEventListener() {},
    removeEventListener() {},
    getSelection: () => null,
    Event: TestEvent,
    Node: TestNode,
    Element: TestElement,
    HTMLElement: TestElement,
    HTMLIFrameElement: class extends TestElement {},
    SVGElement: TestElement,
  }
  document.defaultView = window
  return { document, window, container: document.createElement('div') }
}



const ORG='11111111-1111-4111-8111-111111111111', PROJECT='22222222-2222-4222-8222-222222222222', ENGAGEMENT='33333333-3333-4333-8333-333333333333', CONNECTION='44444444-4444-4444-8444-444444444444'
const scope={organization_id:ORG,project_id:PROJECT,engagement_id:ENGAGEMENT}
const snapshot={...scope,schema_version:1,project_name:'Anka fixture',token:'a'.repeat(32),workshops:['content','design','marketing'].map(department_id=>({department_id,enabled:false,eligible:true}))}
function nodes(n,p){return [...(p(n)?[n]:[]),...n.childNodes.flatMap(c=>nodes(c,p))]}
function props(n){return n[Object.keys(n).find(k=>k.startsWith('__reactProps$'))]}
async function mount(t,reply,_role='operations_admin',saved=null){
 const environment=mountedEnvironment(),calls=[],storage=new Map()
 if(saved)storage.set(`anka-workshop-execution:${ORG}:${ORG}:${PROJECT}:${ENGAGEMENT}`,JSON.stringify(saved))
 const old=Object.fromEntries(['document','window','Event','Node','HTMLElement','IS_REACT_ACT_ENVIRONMENT','__mappingHarness','sessionStorage','fetch'].map(k=>[k,globalThis[k]]))
 Object.assign(globalThis,{document:environment.document,window:environment.window,Event:TestEvent,Node:TestNode,HTMLElement:TestElement,IS_REACT_ACT_ENVIRONMENT:true,
 sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},fetch:()=>{throw Error('Network forbidden')},__mappingHarness:{calls,reply}})
 const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent',plugins:[{name:'mapping-stubs',enforce:'pre',resolveId(id){if(id.endsWith('/lib/supabase.js'))return '/mapping-client';if(id.endsWith('AuthContext.jsx'))return '/mapping-auth'},load(id){if(id==='/mapping-auth')return `export const useAuth=()=>({user:{id:'${ORG}'}})`;if(id==='/mapping-client')return `export const supabase={functions:{invoke:async(_name,{body})=>{globalThis.__mappingHarness.calls.push(body);return globalThis.__mappingHarness.reply(body)}}}`}}]})
 const root=createRoot(environment.container)
 t.after(async()=>{await act(async()=>root.unmount());await server.close();Object.assign(globalThis,old)})
 const {default:Panel}=await server.ssrLoadModule('/src/components/WorkshopExecutionPanel.jsx')
 await act(async()=>root.render(createElement(Panel,{scope,actorId:ORG})))
 async function click(label){const button=nodes(environment.container,n=>n.tagName==='BUTTON'&&n.textContent===label)[0];assert.ok(button,label);await act(async()=>props(button).onClick())}
 async function review(){await click('Load activation settings');await act(async()=>props(nodes(environment.container,n=>n.tagName==='INPUT')[0]).onChange({target:{checked:true}}));await click('Review activation changes')}
 return {environment,calls,storage,click,review}
}
function success(body){return {data:{result:{...scope,schema_version:1,request_id:body.request_id,persisted:true,selections:body.selections,added:body.selections}}}}
test('mapping requires explicit load, review and save; success never dispatches provider',async t=>{
 const m=await mount(t,b=>b.action==='list_workshop_execution'?{data:{result:snapshot}}:success(b));assert.equal(m.calls.length,0)
 await m.review();assert.equal(m.calls.length,1);assert.match(m.environment.container.textContent,/Review Workshop activation/)
 await m.click('Save reviewed activation');assert.equal(m.calls.length,2);assert.match(m.environment.container.textContent,/Workshop activation settings saved/);assert.equal(m.storage.size,0)
})
test('uncertain save retains original UUID; recovery only reads original receipt',async t=>{
 let command;const m=await mount(t,b=>{if(b.action==='list_workshop_execution')return {data:{result:snapshot}};if(b.action==='save_workshop_execution'){command=b;throw Error('secret raw error')};assert.equal(b.request_id,command.request_id);return success(command)})
 await m.review();await m.click('Save reviewed activation');assert.equal(m.storage.size,1);assert.doesNotMatch(m.environment.container.textContent,/secret raw error/)
 await m.click('Check original activation save');assert.equal(m.calls.filter(b=>b.action==='save_workshop_execution').length,1);assert.equal(m.storage.size,0)
})
test('stale review clears review and requires explicit reload',async t=>{
 const m=await mount(t,b=>b.action==='list_workshop_execution'?{data:{result:snapshot}}:{error:{context:{status:409}}})
 await m.review();await m.click('Save reviewed activation');assert.match(m.environment.container.textContent,/Activation review changed/);assert.equal(m.storage.size,0);assert.doesNotMatch(m.environment.container.textContent,/Save reviewed activation/)
})
test('restored original save offers recovery without automatic invocation',async t=>{
 const original={request_id:CONNECTION,expected_token:'a'.repeat(32),selections:[{department_id:'content',enabled:true}]}
 const m=await mount(t,()=>({data:{result:null}}),'operations_admin',original);assert.equal(m.calls.length,0);assert.match(m.environment.container.textContent,/Check original activation save/);await m.click('Check original activation save');assert.equal(m.storage.size,1);assert.match(m.environment.container.textContent,/No committed receipt/)
})
