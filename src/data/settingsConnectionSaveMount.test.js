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


const ORG = '11111111-1111-4111-8111-111111111111'
const ID = '22222222-2222-4222-8222-222222222222'
function nodes(node, predicate) { return [...(predicate(node) ? [node] : []), ...node.childNodes.flatMap(child => nodes(child, predicate))] }
function props(node) { return node[Object.keys(node).find(key => key.startsWith('__reactProps$'))] }
function input(environment, label) { return nodes(environment.container, n => n.tagName === 'LABEL' && n.textContent.startsWith(label)).flatMap(n => nodes(n, child => child.tagName === 'INPUT'))[0] }
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }) }
async function mount(t, reply) {
  const environment = mountedEnvironment()
  const old = Object.fromEntries(['document','window','Event','Node','HTMLElement','IS_REACT_ACT_ENVIRONMENT','__saveHarness','fetch'].map(k => [k,globalThis[k]]))
  const calls=[]
  Object.assign(globalThis, {document:environment.document, window:environment.window, Event:TestEvent, Node:TestNode, HTMLElement:TestElement, IS_REACT_ACT_ENVIRONMENT:true,
    fetch:()=>{throw Error('No network')}, __saveHarness:{org:ORG,calls,reply}})
  const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent',resolve:{alias:{'react-router-dom':'/src/data/__settings_router_stub.js'}},plugins:[{name:'save-stubs',enforce:'pre',resolveId(id){
    if(id.endsWith('OrganizationContext.jsx'))return '/save-org'
    if(id.endsWith('integrationRepository.js'))return '/save-repo'
    if(['ContentCustomFieldSettings.jsx','DepartmentChatModelAllowlist.jsx','PipelineAiTextRouteSettings.jsx'].some(n=>id.endsWith(n)))return '/save-child'
    if(id==='react-router-dom')return '/save-router'
  },load(id){
    if(id==='/save-org')return `export const useOrganization=()=>({activeOrganizationId:globalThis.__saveHarness.org,activeMembership:{role:'system_owner'},scopeRevision:1})`
    if(id==='/save-child')return 'export default function Child(){return null}'
    if(id==='/save-router')return 'const p=new URLSearchParams(); export const useSearchParams=()=>[p,()=>{}]'
    if(id==='/save-repo')return `import {saveConnectionMetadata} from '/src/data/integrationSave.js';export const integrations={listForOrganization:async()=>({connections:[],can_manage:true}),listBrands:async()=>[],listModelAllowlist:async()=>({organization_id:globalThis.__saveHarness.org,connections:[],can_manage:true}),saveOrganizationTextConnection:(org,body)=>saveConnectionMetadata(async p=>{globalThis.__saveHarness.calls.push(p);return globalThis.__saveHarness.reply(p)}, {...body,organization_id:org,organization_only:true,department_ids:[]}),save:()=>{throw Error('Wrong save path')}}`
  }}]})
  const root=createRoot(environment.container)
  t.after(async()=>{await act(async()=>root.unmount());await server.close();Object.assign(globalThis,old)})
  const {default:Settings}=await server.ssrLoadModule('/src/apps/Settings.jsx')
  await act(async()=>root.render(createElement(Settings)));await flush()
  for(const [label,value] of [['Connection name','OpenAI Sol Private'],['Default model','gpt-6.1-sol'],['Supabase secret name','ANKA_OPENAI_PRIMARY']]) {
    await act(async()=>props(input(environment,label)).onChange({target:{value}}))
  }
  await act(async()=>props(input(environment,'Organization-only')).onChange({target:{checked:true}}))
  const submit=()=>props(nodes(environment.container,n=>n.tagName==='FORM')[0]).onSubmit({preventDefault(){}})
  return {environment,calls,submit}
}
function saved(body){return {data:{connection:{id:ID,organization_id:ORG,provider:body.provider,display_name:body.display_name,status:'configured',public_config:body.public_config,department_ids:[]}},error:null}}

test('checked private save shows pending adjacent to Save and suppresses duplicate submits until confirmed success',async t=>{
  let resolve
  const m=await mount(t,body=>new Promise(r=>{resolve=()=>r(saved(body))}))
  let pending
  await act(async()=>{pending=m.submit()})
  assert.match(m.environment.container.textContent,/Saving connector metadata/)
  const button=nodes(m.environment.container,n=>n.tagName==='BUTTON'&&n.textContent==='Saving…')[0]
  assert.equal(button.disabled,true);assert.equal(button.getAttribute('aria-describedby'),'connector-save-feedback')
  await act(async()=>m.submit());assert.equal(m.calls.length,1)
  assert.deepEqual(m.calls[0].department_ids,[]);assert.equal(m.calls[0].organization_only,true)
  await act(async()=>{resolve();await pending})
  assert.match(m.environment.container.textContent,/Saved OpenAI Sol Private as an organization-only connection/)
  assert.equal(input(m.environment,'Connection name').value,'')
})
for(const [label,reply,expected] of [
  ['duplicate',()=>({error:{context:new Response(JSON.stringify({code:'connection_name_conflict',error:'SQL secret-value'}),{status:409})}}),/name already exists/],
  ['non-2xx',()=>({error:{message:'Authorization: secret-value',context:new Response('provider secret-value',{status:403})}}),/do not have permission/],
  ['thrown',()=>{throw Error('provider secret-value')},/could not be confirmed/],
  ['missing response',()=>({data:{}}),/could not be confirmed/],
  ['wrong scope',body=>{const r=saved(body);r.data.connection.department_ids=['content'];return r},/could not be confirmed/],
])test(`checked private ${label} failure stays filled with safe inline alert`,async t=>{
  const m=await mount(t,reply);await act(async()=>m.submit())
  const alert=nodes(m.environment.container,n=>n.getAttribute?.('role')==='alert')[0]
  assert.ok(alert);assert.match(alert.textContent,expected);assert.doesNotMatch(m.environment.container.textContent,/SQL secret-value|Authorization: secret-value|provider secret-value/)
  assert.equal(input(m.environment,'Connection name').value,'OpenAI Sol Private')
  assert.equal(input(m.environment,'Organization-only').checked,true)
  assert.equal(m.calls.length,1)
})
