import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { createServer } from 'vite'
import DesignDeniedState from '../components/DesignDeniedState.js'

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
  constructor(nodeType, nodeName, ownerDocument = null) { this.nodeType = nodeType; this.nodeName = nodeName; this.ownerDocument = ownerDocument; this.parentNode = null; this.childNodes = []; this.listeners = new Map() }
  appendChild(node) { node.parentNode = this; this.childNodes.push(node); return node }
  insertBefore(node, before) { const index = this.childNodes.indexOf(before); if (index < 0) return this.appendChild(node); node.parentNode = this; this.childNodes.splice(index, 0, node); return node }
  removeChild(node) { const index = this.childNodes.indexOf(node); if (index >= 0) this.childNodes.splice(index, 1); node.parentNode = null; return node }
  addEventListener(type, listener) { const listeners = this.listeners.get(type) || []; listeners.push(listener); this.listeners.set(type, listeners) }
  removeEventListener(type, listener) { this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener)) }
  dispatchEvent(event) { Object.defineProperty(event, 'target', { configurable: true, value: this }); let node = this; while (node) { Object.defineProperty(event, 'currentTarget', { configurable: true, value: node }); for (const listener of node.listeners.get(event.type) || []) listener.call(node, event); if (!event.bubbles || event.propagationStopped) break; node = node.parentNode } return !event.defaultPrevented }
  contains(node) { return node === this || this.childNodes.some(child => child.contains?.(node)) }
  get firstChild() { return this.childNodes[0] || null }
  get lastChild() { return this.childNodes.at(-1) || null }
  get nextSibling() { if (!this.parentNode) return null; return this.parentNode.childNodes[this.parentNode.childNodes.indexOf(this) + 1] || null }
  get textContent() { return this.nodeType === 3 ? this.data : this.childNodes.map(node => node.textContent).join('') }
  set textContent(value) { if (this.nodeType === 3) this.data = String(value); else { this.childNodes = []; if (value !== '') this.appendChild(this.ownerDocument.createTextNode(String(value))) } }
}

class TestElement extends TestNode {
  constructor(tagName, ownerDocument, namespaceURI = 'http://www.w3.org/1999/xhtml') { super(1, tagName.toUpperCase(), ownerDocument); this.tagName = this.nodeName; this.namespaceURI = namespaceURI; this.attributes = new Map(); this.style = { setProperty(name, value) { this[name] = value }, removeProperty(name) { delete this[name] } }; this.disabled = false; this.tabIndex = 0 }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name.toLowerCase() === 'tabindex') this.tabIndex = Number(value) }
  getAttribute(name) { return this.attributes.get(name) ?? null }
  removeAttribute(name) { this.attributes.delete(name) }
  hasAttribute(name) { return this.attributes.has(name) }
  focus() { this.ownerDocument.activeElement = this }
}

class TestText extends TestNode {
  constructor(data, ownerDocument) { super(3, '#text', ownerDocument); this.data = String(data) }
  get nodeValue() { return this.data }
  set nodeValue(value) { this.data = String(value) }
}

class TestDocument extends TestNode {
  constructor() { super(9, '#document'); this.ownerDocument = this; this.defaultView = null; this.documentElement = new TestElement('html', this); this.body = new TestElement('body', this); this.documentElement.appendChild(this.body); this.appendChild(this.documentElement); this.activeElement = this.body }
  createElement(tagName) { return new TestElement(tagName, this) }
  createElementNS(namespaceURI, tagName) { return new TestElement(tagName, this, namespaceURI) }
  createTextNode(data) { return new TestText(data, this) }
}

function mountedEnvironment() {
  const document = new TestDocument()
  const window = { document, addEventListener() {}, removeEventListener() {}, getSelection: () => null, Event: TestEvent, Node: TestNode, Element: TestElement, HTMLElement: TestElement, HTMLIFrameElement: class extends TestElement {}, SVGElement: TestElement }
  document.defaultView = window
  return { document, window, container: document.createElement('div') }
}

function elements(root, tagName) {
  const result = []
  const tag = tagName.toUpperCase()
  function visit(node) { if (node.tagName === tag) result.push(node); for (const child of node.childNodes || []) visit(child) }
  visit(root)
  return result
}

function byText(root, tagName, text) {
  return elements(root, tagName).find(node => node.textContent.includes(text))
}

function surfaceEvidence(root) {
  const evidence = []
  function visit(node) {
    if (node.nodeType === 3) evidence.push(node.data)
    if (node.attributes) {
      for (const [name, value] of node.attributes) evidence.push(`${name}=${value}`)
    }
    for (const child of node.childNodes || []) visit(child)
  }
  visit(root)
  return evidence.join(' ')
}

function installEnvironment(t) {
  const environment = mountedEnvironment()
  const previous = { document: globalThis.document, window: globalThis.window, Event: globalThis.Event, Node: globalThis.Node, HTMLElement: globalThis.HTMLElement, act: globalThis.IS_REACT_ACT_ENVIRONMENT }
  Object.assign(globalThis, { document: environment.document, window: environment.window, Event: TestEvent, Node: TestNode, HTMLElement: TestElement, IS_REACT_ACT_ENVIRONMENT: true })
  t.after(() => Object.assign(globalThis, { document: previous.document, window: previous.window, Event: previous.Event, Node: previous.Node, HTMLElement: previous.HTMLElement, IS_REACT_ACT_ENVIRONMENT: previous.act }))
  return environment
}

function tabStops(root) {
  return elements(root, 'button').filter(node => !node.disabled && node.tabIndex >= 0)
}

function pressTab(root) {
  const stops = tabStops(root)
  const current = stops.indexOf(root.ownerDocument.activeElement)
  stops[(current + 1) % stops.length]?.focus()
}

test('mounted Workshop tabs use roving focus for keyboard, mouse, Tab, and navigation changes', async t => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  t.after(() => server.close())
  const { default: WorkshopTabs } = await server.ssrLoadModule('/src/components/WorkshopTabs.jsx')
  const environment = installEnvironment(t)

  function Harness({ requestedTab }) {
    const [activeTab, setActiveTab] = useState(requestedTab)
    useEffect(() => setActiveTab(requestedTab), [requestedTab])
    return createElement('div', null,
      createElement('button', { id: 'before' }, 'Before tabs'),
      createElement(WorkshopTabs, { departmentId: 'design', activeTab, onChange: setActiveTab }),
      createElement('section', { id: `design-${activeTab}-panel`, role: 'tabpanel', 'aria-labelledby': `design-${activeTab}-tab` }, `Panel ${activeTab}`),
      createElement('button', { id: 'after' }, 'After tabs'),
    )
  }

  const root = createRoot(environment.container)
  t.after(() => { try { root.unmount() } catch { /* already unmounted */ } })
  await act(async () => root.render(createElement(Harness, { requestedTab: 'tasks' })))

  const tabs = () => elements(environment.container, 'button').filter(node => node.getAttribute('role') === 'tab')
  const selected = () => tabs().find(node => node.getAttribute('aria-selected') === 'true')
  assert.equal(tabs().filter(node => node.tabIndex === 0).length, 1)
  assert.equal(selected().textContent, 'Project Tasks')
  assert.equal(selected().getAttribute('aria-controls'), 'design-tasks-panel')
  assert.equal(elements(environment.container, 'section')[0].getAttribute('aria-labelledby'), 'design-tasks-tab')

  byText(environment.container, 'button', 'Before tabs').focus()
  pressTab(environment.container)
  assert.equal(environment.document.activeElement.textContent, 'Project Tasks')
  pressTab(environment.container)
  assert.equal(environment.document.activeElement.textContent, 'After tabs')

  selected().focus()
  await act(async () => selected().dispatchEvent(new TestEvent('keydown', { bubbles: true, key: 'ArrowRight' })))
  assert.equal(selected().textContent, 'Engagement Work Items')
  assert.equal(environment.document.activeElement, selected())

  await act(async () => selected().dispatchEvent(new TestEvent('keydown', { bubbles: true, key: 'End' })))
  assert.equal(selected().textContent, 'Connectors')
  await act(async () => selected().dispatchEvent(new TestEvent('keydown', { bubbles: true, key: 'Home' })))
  assert.equal(selected().textContent, 'Project Tasks')
  await act(async () => selected().dispatchEvent(new TestEvent('keydown', { bubbles: true, key: 'ArrowLeft' })))
  assert.equal(selected().textContent, 'Connectors')

  await act(async () => byText(environment.container, 'button', 'Research').dispatchEvent(new TestEvent('click', { bubbles: true, button: 0 })))
  assert.equal(selected().textContent, 'Research')
  assert.equal(environment.document.activeElement.textContent, 'Research')

  await act(async () => root.render(createElement(Harness, { requestedTab: 'specialists' })))
  assert.equal(selected().textContent, 'Specialist Queues')
  assert.equal(environment.document.activeElement, selected())
  assert.equal(tabs().filter(node => node.tabIndex === 0).length, 1)
})

test('mounted Design denial hides every rejected context value and keeps both safe exits', async t => {
  const environment = installEnvironment(t)
  const root = createRoot(environment.container)
  t.after(() => { try { root.unmount() } catch { /* already unmounted */ } })

  const rejectedSentinels = [
    'rejected-org-sentinel', 'rejected-client-sentinel', 'rejected-project-sentinel',
    'rejected-engagement-sentinel', 'rejected-brand-sentinel', 'rejected-service-sentinel',
    'rejected-stage-sentinel', 'rejected-origin-sentinel', 'rejected-origin-tab-sentinel',
    'rejected-work-sentinel', 'rejected-output-sentinel', 'rejected-version-sentinel',
    'rejected-draft-sentinel', 'rejected-tab-sentinel', 'rejected-reason-sentinel',
  ]
  const rejectedNavigation = {
    status: 'parsed', reason: 'rejected-reason-sentinel',
    organizationId: rejectedSentinels[0], clientId: rejectedSentinels[1], projectId: rejectedSentinels[2],
    engagementId: rejectedSentinels[3], brandId: rejectedSentinels[4], activeServiceId: rejectedSentinels[5],
    stageId: rejectedSentinels[6], origin: `/sphere/workspace/projects/${rejectedSentinels[7]}`,
    originTab: rejectedSentinels[8], workRecord: { kind: 'project_task', id: rejectedSentinels[9] },
    output: { kind: 'design_session', id: rejectedSentinels[10], versionId: rejectedSentinels[11] },
    draft: { kind: 'private_experiment', id: rejectedSentinels[12] }, workshopTab: rejectedSentinels[13],
  }
  const validationCases = [
    { status: 'denied', reason: 'access_denied', context: null },
    { status: 'stale', reason: 'work_record_unavailable', context: null, rejected: true },
    { status: 'error', reason: 'load_failed', context: null, error: new Error(rejectedSentinels[14]) },
  ]

  for (const [index, validation] of validationCases.entries()) {
    const caseRouter = createMemoryRouter([{
      path: '*',
      element: createElement(DesignDeniedState, {
        activeOrganizationId: 'active-org-sentinel', onChoose: () => {},
        navigation: rejectedNavigation, validation,
      }),
    }], { initialEntries: [`/sphere/design/workshop?case=${index}`] })
    await act(async () => root.render(createElement(RouterProvider, { router: caseRouter, key: index })))
    const evidence = surfaceEvidence(environment.container)
    for (const sentinel of rejectedSentinels) assert.ok(!evidence.includes(sentinel), `${sentinel} leaked for ${validation.status}`)
    assert.ok(evidence.includes('active-org-sentinel'))
    assert.match(environment.container.textContent, /No work has been opened/)
  }

  let chooseCount = 0
  let router
  router = createMemoryRouter([{
    path: '*',
    element: createElement(DesignDeniedState, {
      activeOrganizationId: 'active-org-sentinel',
      onChoose: () => { chooseCount += 1; router.navigate('/sphere/design/workshop') },
      navigation: rejectedNavigation,
      validation: validationCases[0],
    }),
  }], { initialEntries: ['/sphere/design/workshop?ctxOrg=rejected-org-sentinel&ctxProject=rejected-project-sentinel'] })

  await act(async () => root.render(createElement(RouterProvider, { router, key: 'interactive' })))
  const back = byText(environment.container, 'a', 'Back to Design Workshop')
  assert.ok(back)
  assert.equal(back.getAttribute('href'), '/sphere/design?ctxOrg=active-org-sentinel')
  await act(async () => back.dispatchEvent(new TestEvent('click', { bubbles: true, button: 0 })))
  assert.equal(router.state.location.pathname, '/sphere/design')
  assert.equal(router.state.location.search, '?ctxOrg=active-org-sentinel')

  await act(async () => byText(environment.container, 'button', 'Choose permitted work').dispatchEvent(new TestEvent('click', { bubbles: true, button: 0 })))
  assert.equal(chooseCount, 1)
  assert.equal(router.state.location.pathname, '/sphere/design/workshop')
  assert.equal(router.state.location.search, '')
  const finalEvidence = surfaceEvidence(environment.container)
  for (const sentinel of rejectedSentinels) assert.ok(!finalEvidence.includes(sentinel))
})
