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

function workshopStubs() {
  return {
    name: 'department-workshop-stubs',
    enforce: 'pre',
    resolveId(source) {
      if (source && source.endsWith('AuthContext.jsx')) return '/0dws-auth'
      if (source && source.endsWith('OrganizationContext.jsx')) return '/0dws-org'
      if (source && source.endsWith('delivery.js')) return '/0dws-delivery'
      if (source && source.endsWith('DepartmentChat.jsx')) return '/0dws-chat'
      if (source && source.endsWith('ContextConversationPanel.jsx')) return '/0dws-private'
      return null
    },
    load(id) {
      if (id === '/0dws-chat') return "import { createElement } from 'react'; export default function Chat(props) { return createElement('p', null, 'Chat for ' + props.engagement.name) }"
      if (id === '/0dws-private') return "import { createElement } from 'react'; export default function Chat(props) { return createElement('p', null, props.contextKind + ':' + props.departmentId + ':' + props.workshopLayout) }"
      if (id === '/0dws-auth' || id === '\\\\0dws-auth') return 'export const useAuth = () => globalThis.__dwsHarness.auth'
      if (id === '/0dws-org' || id === '\\\\0dws-org') return 'export const useOrganization = () => globalThis.__dwsHarness.organization'
      if (id === '/0dws-delivery' || id === '\\\\0dws-delivery') {
        return `export const delivery = Object.freeze({
          getDepartmentWorkspace: (...args) => globalThis.__dwsHarness.delivery.getDepartmentWorkspace(...args),
          transitionTask: () => Promise.resolve(),
          createTask: () => Promise.resolve(),
          createResearchRecord: () => Promise.resolve(),
          createDeliverable: () => Promise.resolve(),
          createInternalRequest: () => Promise.resolve(),
        })`
      }
      return null
    },
  }
}

async function workshopServer(t) {
  const server = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent',
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('https://example.supabase.co'),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('test-key'),
    },
    plugins: [workshopStubs()],
    resolve: {
      alias: {
        'react-router-dom': '/src/data/__dws_router_stub.js',
      },
    },
  })
  t.after(() => server.close())
  return server
}

function flush() {
  return act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

async function waitForStable(environment, condition, message = 'condition was not met') {
  for (let index = 0; index < 30; index += 1) {
    if (condition()) return
    await flush()
  }
  throw new Error(message)
}

async function mountWorkshop(t, DepartmentWorkshop, departmentId, harness) {
  const environment = mountedEnvironment()
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    Event: globalThis.Event,
    Node: globalThis.Node,
    HTMLElement: globalThis.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: globalThis.IS_REACT_ACT_ENVIRONMENT,
    dwsHarness: globalThis.__dwsHarness,
  }

  Object.assign(globalThis, {
    document: environment.document,
    window: environment.window,
    Event: TestEvent,
    Node: TestNode,
    HTMLElement: TestElement,
    IS_REACT_ACT_ENVIRONMENT: true,
    __dwsHarness: {
      search: harness.search || '',
      auth: harness.auth,
      organization: harness.organization,
      delivery: harness.delivery,
    },
  })

  const root = createRoot(environment.container)
  let cleaned = false
  const cleanup = async () => {
    if (cleaned) return
    cleaned = true
    await act(async () => root.unmount())
    Object.assign(globalThis, {
      document: previous.document,
      window: previous.window,
      Event: previous.Event,
      Node: previous.Node,
      HTMLElement: previous.HTMLElement,
      IS_REACT_ACT_ENVIRONMENT: previous.IS_REACT_ACT_ENVIRONMENT,
      __dwsHarness: previous.dwsHarness,
    })
  }
  t.after(cleanup)

  await act(async () => root.render(createElement(DepartmentWorkshop, { departmentId })))
  await flush()

  return { environment, root, cleanup }
}

function withOrganizationScope(overrides) {
  return {
    activeMembership: { role: 'system_owner' },
    activeOrganizationId: 'org-1',
    selectionRequired: false,
    loading: false,
    handleOrganizationAccessError: () => false,
    scopeRevision: 1,
    requestSignal: { aborted: false, addEventListener() {}, removeEventListener() {} },
    ...overrides,
  }
}

function workspaceBase() {
  return {
    workstreams: [
      { id: 'workstream-a', project_id: 'project-a', projects: { name: 'Launch', organization_id: 'org-1', client_id: 'client-a', due_date: '2026-09-01' } },
    ],
    relatedWorkstreams: [
      { id: 'workstream-related', project_id: 'project-a', name: 'R', projects: { name: 'Launch', organization_id: 'org-1', client_id: 'client-a', due_date: '2026-09-01' } },
    ],
    engagements: [{ id: 'engagement-a', project_id: 'project-a', organization_id: 'org-1', brand_id: 'brand-a', projects: { client_id: 'client-a' } }],
    services: [{ id: 'service-a', engagement_id: 'engagement-a' }],
    stages: [{ id: 'stage-a', engagement_id: 'engagement-a' }],
    tasks: [],
    workItems: [],
    research: [],
    deliverables: [],
    requests: [],
    milestones: [],
  }
}

const departments = ['content', 'design', 'marketing']

for (const department of departments) {
  test(`mounted ${department} defaults to private exploration with secondary tools`, async t => {
    const vite = await workshopServer(t)
    const { default: Workshop } = await vite.ssrLoadModule('/src/apps/DepartmentWorkshop.jsx')
    const { environment } = await mountWorkshop(t, Workshop, department, {
      auth: { user: { id: 'user-1' } }, organization: withOrganizationScope(),
      delivery: { getDepartmentWorkspace: async () => workspaceBase() },
    })
    const text = environment.container.textContent
    assert.match(text, new RegExp('department_private:' + department + ':true'))
    assert.match(text, /does not share or move these messages/)
    assert.match(text, /Work queue & tools/)
    assert.match(text, /Assets & outputs|Reviews/)
    assert.doesNotMatch(text, /Active workstreams|Chat for/)
    const all = node => [node, ...node.childNodes.flatMap(all)]
    const projectButton = all(environment.container).find(node => node.tagName === 'BUTTON' && node.textContent === 'Project / engagement chat')
    await act(async () => projectButton.dispatchEvent(new TestEvent('click')))
    assert.match(environment.container.textContent, /Shared Department Chat/)
    assert.doesNotMatch(environment.container.textContent, /department_private:/)
    const queue = all(environment.container).find(node => node.tagName === 'SELECT' && node.getAttribute('aria-label') === 'Work queue and tools')
    const queueProps = queue[Object.keys(queue).find(key => key.startsWith('__reactProps$'))]
    await act(async () => queueProps.onChange({ target: { value: 'tasks' } }))
    assert.match(environment.container.textContent, /No Project Tasks in this workstream/)
  })
}

for (const department of departments) {
  test(`mounted ${department} workshop renders an empty workspace`, async (t) => {
    const vite = await workshopServer(t)
    const { default: DepartmentWorkshop } = await vite.ssrLoadModule('/src/apps/DepartmentWorkshop.jsx')
    const workspace = {
      workstreams: [],
      relatedWorkstreams: [],
      engagements: [],
      services: [],
      stages: [],
      tasks: [],
      workItems: [],
      research: [],
      deliverables: [],
      requests: [],
      milestones: [],
    }
    const { environment } = await mountWorkshop(t, DepartmentWorkshop, department, {
      auth: { user: { id: 'user-1' } },
      organization: withOrganizationScope(),
      delivery: { getDepartmentWorkspace: async () => workspace },
      search: '?ctxWorkshopTab=tasks',
    })

    await waitForStable(environment, () => /No active/.test(environment.container.textContent), `empty-workspace-${department}`)
    const text = environment.container.textContent
    assert.ok(/No active (Content|Design|Marketing) workstreams/.test(text))
    assert.equal(/Cannot read properties/.test(text), false)
    assert.equal(/TypeError: Cannot/.test(text), false)
  })
}

test('mounted workshops keep integrity when no engagement matches context', async (t) => {
  const vite = await workshopServer(t)
  const { default: DepartmentWorkshop } = await vite.ssrLoadModule('/src/apps/DepartmentWorkshop.jsx')
  const workspace = {
    ...workspaceBase(),
    engagements: [],
    services: [
      { id: 'service-orphan', engagement_id: undefined },
      { id: 'service-other', engagement_id: 'engagement-other' },
    ],
    stages: [{ id: 'stage-orphan', engagement_id: undefined }],
  }

  for (const department of departments) {
    const { environment, cleanup } = await mountWorkshop(t, DepartmentWorkshop, department, {
      auth: { user: { id: 'user-1' } },
      organization: withOrganizationScope(),
      delivery: { getDepartmentWorkspace: async () => workspace },
      search: '?ctxOrg=org-1&ctxProject=project-a&ctxEngagement=missing-engagement&ctxService=service-orphan&ctxStage=stage-orphan',
    })

    await flush()
    const text = environment.container.textContent
    assert.equal(/Cannot read properties/.test(text), false)
    assert.equal(/TypeError: Cannot/.test(text), false)
    assert.ok(/Workshop context not opened|No active (Content|Design|Marketing) workstreams/.test(text))
    await cleanup()
  }
})

test('mounted workshops accept valid exact context and reject missing pointers', async (t) => {
  const vite = await workshopServer(t)
  const { default: DepartmentWorkshop } = await vite.ssrLoadModule('/src/apps/DepartmentWorkshop.jsx')

  const validWorkspace = workspaceBase()
  const validQuery = '?ctxOrg=org-1&ctxProject=project-a&ctxEngagement=engagement-a&ctxService=service-a&ctxStage=stage-a&ctxWorkshopTab=tasks'
  for (const department of departments) {
    const { environment, cleanup } = await mountWorkshop(t, DepartmentWorkshop, department, {
      auth: { user: { id: 'user-1' } },
      organization: withOrganizationScope(),
      delivery: { getDepartmentWorkspace: async () => validWorkspace },
      search: validQuery,
    })

    await waitForStable(
      environment,
      () => /No Project Tasks in this workstream/.test(environment.container.textContent),
      `valid-context-${department}`,
    )

    const validText = environment.container.textContent
    assert.equal(/Cannot read properties/.test(validText), false)
    assert.ok(/No Project Tasks in this workstream|No active/.test(validText))
    await cleanup()
  }

  const invalidWorkspace = {
    ...workspaceBase(),
    services: [{ id: 'service-missing', engagement_id: 'engagement-a' }],
    stages: [{ id: 'stage-missing', engagement_id: 'engagement-a' }],
  }

  for (const department of departments) {
    const { environment, cleanup } = await mountWorkshop(t, DepartmentWorkshop, department, {
      auth: { user: { id: 'user-1' } },
      organization: withOrganizationScope(),
      delivery: { getDepartmentWorkspace: async () => invalidWorkspace },
      search: `${validQuery}&ctxService=service-a&ctxStage=stage-a`,
    })

    await flush()
    const invalidText = environment.container.textContent
    assert.equal(/Cannot read properties/.test(invalidText), false)
    assert.equal(/TypeError: Cannot/.test(invalidText), false)
    assert.equal(/Workshop context not opened/.test(invalidText), true)
    await cleanup()
  }
})



test('mounted Workshop chat shows the exact eligible engagement and a clear prerequisite otherwise', async t => {
  const vite = await workshopServer(t)
  const { default: DepartmentWorkshop } = await vite.ssrLoadModule('/src/apps/DepartmentWorkshop.jsx')
  const workspace = {
    ...workspaceBase(),
    engagements: [{ ...workspaceBase().engagements[0], name: 'Launch engagement' }],
    services: [{ id: 'service-a', engagement_id: 'engagement-a', status: 'active' }],
  }
  for (const department of departments) {
    const { environment, cleanup } = await mountWorkshop(t, DepartmentWorkshop, department, {
      auth: { user: { id: 'user-1' } },
      organization: withOrganizationScope(),
      delivery: { getDepartmentWorkspace: async () => workspace },
      search: '?ctxOrg=org-1&ctxProject=project-a&ctxEngagement=engagement-a&ctxWorkshopTab=chat',
    })
    await waitForStable(environment, () => /Chat for Launch engagement/.test(environment.container.textContent), 'chat-' + department)
    assert.match(environment.container.textContent, /Shared Department Chat/)
    assert.match(environment.container.textContent, /Project brief & context/)
    assert.match(environment.container.textContent, /Assets, outputs & review evidence/)
    await cleanup()
  }
  const { environment } = await mountWorkshop(t, DepartmentWorkshop, 'design', {
    auth: { user: { id: 'user-1' } },
    organization: withOrganizationScope(),
    delivery: { getDepartmentWorkspace: async () => ({ ...workspace, services: [] }) },
    search: '?ctxOrg=org-1&ctxProject=project-a&ctxWorkshopTab=chat',
  })
  await waitForStable(environment, () => /No eligible engagement/.test(environment.container.textContent))
  assert.doesNotMatch(environment.container.textContent, /Chat for Launch engagement/)
})
