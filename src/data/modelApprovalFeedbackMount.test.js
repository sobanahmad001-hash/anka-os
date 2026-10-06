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



const ORG='11111111-1111-4111-8111-111111111111', ID='22222222-2222-4222-8222-222222222222'
const row={id:ID,display_name:'Sol',provider:'openai',status:'verified',verified_model_ids:['gpt-6.1-sol'],department_ids:['content'],model_configurations:[{department_id:'content',model_id:'gpt-6.1-sol'}]}
function nodes(n,p){return [...(p(n)?[n]:[]),...n.childNodes.flatMap(c=>nodes(c,p))]}
function props(n){return n[Object.keys(n).find(k=>k.startsWith('__reactProps$'))]}
async function mount(t,reply,connection=row){
 const env=mountedEnvironment(), calls=[]
 const keys=['document','window','Event','Node','HTMLElement','IS_REACT_ACT_ENVIRONMENT','__approvalHarness','fetch']
 const old=Object.fromEntries(keys.map(k=>[k,globalThis[k]]))
 Object.assign(globalThis,{document:env.document,window:env.window,Event:TestEvent,Node:TestNode,HTMLElement:TestElement,IS_REACT_ACT_ENVIRONMENT:true,fetch:()=>{throw Error('Network forbidden')},__approvalHarness:{calls,reply}})
 const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent',plugins:[{name:'approval-stubs',enforce:'pre',resolveId(id){if(id.endsWith('integrationRepository.js'))return '/approval-client'},load(id){if(id==='/approval-client')return "export const integrations=new Proxy({}, {get:(_,name)=>async(...args)=>{globalThis.__approvalHarness.calls.push({name,args});return globalThis.__approvalHarness.reply(name,args)}})"}}]})
 const root=createRoot(env.container)
 t.after(async()=>{await act(async()=>root.unmount());await server.close();Object.assign(globalThis,old)})
 const {default:Panel}=await server.ssrLoadModule('/src/components/DepartmentChatModelAllowlist.jsx')
 const render=async connections=>act(async()=>root.render(createElement(Panel,{organizationId:ORG,connections,canManage:true})))
 await render([connection])
 const button=label=>nodes(env.container,n=>n.tagName==='BUTTON'&&n.textContent===label)[0]
 const click=async label=>act(async()=>props(button(label)).onClick())
 return {env,calls,button,click,render}
}
const saved=name=>name==='listModelAllowlist'?{organization_id:ORG,connections:[row]}:{success:true}
test('department approval has durable card-local persisted confirmation after refresh',async t=>{
 const m=await mount(t,saved);await m.click('Save department model approval')
 const card=nodes(m.env.container,n=>n.tagName==='ARTICLE')[0]
 assert.match(card.textContent,/Approval saved and confirmed/);assert.match(card.textContent,/Workshop project connections are a separate step/)
 await m.render([{...row}]);assert.match(card.textContent,/Approval saved and confirmed/)
 assert.deepEqual(m.calls.map(c=>c.name),['configureModelAllowlist','listModelAllowlist'])
})
test('lost acknowledgement uses only readback and does not pretend original save confirmed',async t=>{
 const m=await mount(t,name=>{if(name==='configureModelAllowlist')throw Error('raw SQL secret');return saved(name)})
 await m.click('Save department model approval')
 assert.match(m.env.container.textContent,/Current stored approvals confirmed/);assert.doesNotMatch(m.env.container.textContent,/raw SQL secret|Approval saved and confirmed/)
})
test('missing readback keeps selections and reports unconfirmed without raw errors',async t=>{
 const m=await mount(t,()=>{throw Error('secret')});await m.click('Save department model approval')
 assert.match(m.env.container.textContent,/outcome could not be confirmed/);assert.doesNotMatch(m.env.container.textContent,/secret/)
 assert.equal(nodes(m.env.container,n=>n.tagName==='INPUT')[0].checked,true)
})
test('resolved malformed acknowledgement and mismatched stored rows do not report saved',async t=>{
 const m=await mount(t,name=>name==='listModelAllowlist'?{organization_id:ORG,connections:[{...row,model_configurations:[]}]}:{})
 await m.click('Save department model approval');assert.match(m.env.container.textContent,/Stored approvals do not match/);assert.doesNotMatch(m.env.container.textContent,/saved and confirmed/)
})
test('synchronous repeated click has one mutation and a pending message',async t=>{
 let release;const waiting=new Promise(resolve=>{release=resolve})
 const m=await mount(t,name=>name==='configureModelAllowlist'?waiting:saved(name))
 const handler=props(m.button('Save department model approval')).onClick
 let first;await act(async()=>{first=handler();handler()})
 assert.equal(m.calls.length,1);assert.match(m.env.container.textContent,/Saving approval and checking/)
 await act(async()=>{release({success:true});await first})
})
test('private-only card has only private approval action and exact private readback',async t=>{
 const privateRow={...row,organization_level:true,department_ids:[],model_configurations:[],context_model_configurations:[{model_id:'gpt-6.1-sol'}]}
 const m=await mount(t,name=>name==='listModelAllowlist'?{organization_id:ORG,connections:[privateRow]}:{success:true},privateRow)
 assert.equal(m.button('Save department model approval'),undefined)
 await m.click('Save private model access')
 assert.match(m.env.container.textContent,/Private conversations:.*Sol/);assert.equal(m.calls[0].name,'configureContextOrganizationModels')
})
test('wrong organization readback never confirms save',async t=>{
 const m=await mount(t,name=>name==='listModelAllowlist'?{organization_id:ID,connections:[row]}:{success:true})
 await m.click('Save department model approval');assert.match(m.env.container.textContent,/outcome could not be confirmed/)
})
