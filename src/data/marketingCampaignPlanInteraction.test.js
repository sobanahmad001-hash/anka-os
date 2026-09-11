import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement } from 'react'
import { createServer } from 'vite'

class TestEvent {
  constructor(type, options = {}) { this.type = type; this.bubbles = options.bubbles !== false; this.cancelable = true; this.defaultPrevented = false; this.propagationStopped = false }
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
  constructor(tagName, ownerDocument, namespaceURI = 'http://www.w3.org/1999/xhtml') { super(1, tagName.toUpperCase(), ownerDocument); this.tagName = this.nodeName; this.namespaceURI = namespaceURI; this.attributes = new Map(); this.style = { setProperty(name, value) { this[name] = value }, removeProperty(name) { delete this[name] } }; this._value = ''; this.checked = false; this.selected = false; this.disabled = false }
  get options() { return this.tagName === 'SELECT' ? this.childNodes.filter(node => node.tagName === 'OPTION') : undefined }
  get value() { return this.tagName === 'SELECT' ? this.options.find(option => option.selected)?.value ?? this._value : this._value }
  set value(value) { this._value = String(value); if (this.tagName === 'SELECT') for (const option of this.options) option.selected = option.value === this._value }
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === 'value') this.value = String(value); if (name === 'disabled') this.disabled = true }
  getAttribute(name) { return this.attributes.get(name) ?? null }
  removeAttribute(name) { this.attributes.delete(name); if (name === 'disabled') this.disabled = false }
  hasAttribute(name) { return this.attributes.has(name) }
  focus() { this.ownerDocument.activeElement = this }
}

class TestText extends TestNode {
  constructor(data, ownerDocument) { super(3, '#text', ownerDocument); this.data = String(data) }
  get nodeValue() { return this.data }
  set nodeValue(value) { this.data = String(value) }
}

class TestDocument extends TestNode {
  constructor() { super(9, '#document'); this.ownerDocument = this; this.defaultView = null; this.oninput = null; this.documentElement = new TestElement('html', this); this.body = new TestElement('body', this); this.documentElement.appendChild(this.body); this.appendChild(this.documentElement); this.activeElement = this.body }
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
  const result = []; const tag = tagName.toUpperCase()
  function visit(node) { if (node.tagName === tag) result.push(node); for (const child of node.childNodes || []) visit(child) }
  visit(root); return result
}
const byText = (root, tagName, text) => elements(root, tagName).find(node => node.textContent.includes(text))
const byLabel = (root, label) => ['input', 'textarea', 'select'].flatMap(tag => elements(root, tag)).find(node => node.getAttribute('aria-label') === label)
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const emptySnapshot = () => ({
  versions: [], requirements: [],
  artifacts: [
    { id: 'message', organization_id: 'org-a', engagement_id: 'eng-a', artifact_type: 'campaign_messaging', title: 'Approved launch message' },
    { id: 'measure', organization_id: 'org-a', engagement_id: 'eng-a', artifact_type: 'measurement_plan', title: 'Launch measurement' },
  ],
  sourceVersions: [
    { id: 'message-v1', organization_id: 'org-a', artifact_id: 'message', version_number: 1 },
    { id: 'measure-v2', organization_id: 'org-a', artifact_id: 'measure', version_number: 2 },
  ],
  approvals: [{ artifact_version_id: 'message-v1' }],
})

async function mountedComponent(t) {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  t.after(() => server.close())
  const { default: MarketingCampaignPlan } = await server.ssrLoadModule('/src/components/MarketingCampaignPlan.jsx')
  const environment = mountedEnvironment()
  const previous = { document: globalThis.document, window: globalThis.window, Event: globalThis.Event, Node: globalThis.Node, HTMLElement: globalThis.HTMLElement, act: globalThis.IS_REACT_ACT_ENVIRONMENT }
  Object.assign(globalThis, { document: environment.document, window: environment.window, Event: TestEvent, Node: TestNode, HTMLElement: TestElement, IS_REACT_ACT_ENVIRONMENT: true })
  t.after(() => Object.assign(globalThis, { document: previous.document, window: previous.window, Event: previous.Event, Node: previous.Node, HTMLElement: previous.HTMLElement, IS_REACT_ACT_ENVIRONMENT: previous.act }))
  const { createRoot } = await import('react-dom/client')
  const root = createRoot(environment.container)
  t.after(() => { try { root.unmount() } catch { /* already unmounted */ } })
  return { MarketingCampaignPlan, environment, root }
}

async function setValue(node, value) {
  const previous = node.value
  node.value = value
  node._valueTracker?.setValue(previous)
  await act(async () => {
    node.dispatchEvent(new TestEvent('input', { bubbles: true }))
    node.dispatchEvent(new TestEvent('change', { bubbles: true }))
  })
}

test('mounted plan loads, selects exact sources, saves, reloads, and appends revision history', async t => {
  const { MarketingCampaignPlan, environment, root } = await mountedComponent(t)
  const firstLoad = deferred()
  let snapshot = emptySnapshot()
  const saves = []
  let loadCount = 0
  const repository = {
    load: async () => loadCount++ === 0 ? firstLoad.promise : snapshot,
    saveDraft: async input => {
      saves.push(input)
      const version = {
        id: `plan-v${saves.length}`, organization_id: 'org-a', engagement_id: 'eng-a', campaign_id: 'campaign-a', brand_id: 'brand-a',
        version_number: saves.length, lifecycle_status: 'draft', created_at: `2026-09-11T1${saves.length}:00:00Z`, ...input.plan,
      }
      snapshot = {
        ...snapshot, versions: [version, ...snapshot.versions],
        requirements: [...snapshot.requirements, ...input.plan.creative_requirements.map((item, index) => ({ id: `${version.id}-r${index}`, organization_id: 'org-a', plan_version_id: version.id, position: index + 1, ...item }))],
      }
      return version
    },
  }
  const props = {
    organizationId: 'org-a', engagement: { id: 'eng-a', name: 'Engagement A' },
    campaign: { id: 'campaign-a', name: 'Campaign A', objective: 'Seed objective', planned_channels: ['Email'] },
    repository, canEdit: true, onAccessError: () => {},
  }
  await act(async () => root.render(createElement(MarketingCampaignPlan, props)))
  assert.match(environment.container.textContent, /Loading campaign plan/)
  await act(async () => firstLoad.resolve(snapshot))
  assert.equal(byLabel(environment.container, 'Plan title').value, 'Campaign A')
  assert.equal(elements(environment.container, 'option').filter(option => option.textContent.includes('Approved launch message')).length, 1)
  await setValue(byLabel(environment.container, 'Plan title'), 'Version one')
  await setValue(byLabel(environment.container, 'Plan objective'), 'Qualified demand')
  await setValue(byLabel(environment.container, 'Plan channels'), 'Email\nSearch')
  await setValue(byLabel(environment.container, 'Approved message version'), 'message-v1')
  await setValue(byLabel(environment.container, 'Measurement source version'), 'measure-v2')
  await act(async () => byText(environment.container, 'button', 'Add creative requirement').dispatchEvent(new TestEvent('click', { bubbles: true })))
  await setValue(byLabel(environment.container, 'Creative format 1'), 'Static image')
  await setValue(byLabel(environment.container, 'Creative placement 1'), 'Homepage hero')
  await setValue(byLabel(environment.container, 'Creative message version 1'), 'message-v1')
  assert.equal(byLabel(environment.container, 'Plan title').value, 'Version one')
  assert.equal(byLabel(environment.container, 'Approved message version').value, 'message-v1')
  assert.equal(byLabel(environment.container, 'Measurement source version').value, 'measure-v2')
  assert.equal(byLabel(environment.container, 'Creative placement 1').value, 'Homepage hero')
  assert.equal(byText(environment.container, 'button', 'Save unapproved version').disabled, false)
  await act(async () => elements(environment.container, 'form')[0].dispatchEvent(new TestEvent('submit', { bubbles: true })))
  assert.equal(saves.length, 1)
  assert.equal(saves[0].expected_latest_version_id, null)
  assert.equal(saves[0].plan.approved_message_version_id, 'message-v1')
  assert.equal(saves[0].plan.creative_requirements[0].intended_placement, 'Homepage hero')
  assert.match(environment.container.textContent, /Saved unapproved plan version 1/)
  assert.match(elements(environment.container, 'aside')[0].textContent, /Version one/)

  await setValue(byLabel(environment.container, 'Plan title'), 'Version two')
  await act(async () => elements(environment.container, 'form')[0].dispatchEvent(new TestEvent('submit', { bubbles: true })))
  assert.equal(saves[1].expected_latest_version_id, 'plan-v1')
  assert.match(environment.container.textContent, /Saved unapproved plan version 2/)
  assert.equal(byText(environment.container, 'button', 'Version 1 · draft') !== undefined, true)
  await act(async () => byText(environment.container, 'button', 'Version 1 · draft').dispatchEvent(new TestEvent('click', { bubbles: true })))
  assert.match(elements(environment.container, 'aside')[0].textContent, /Version one/)
})

test('mounted plan reports save errors and rejects stale completions after context switch', async t => {
  const { MarketingCampaignPlan, environment, root } = await mountedComponent(t)
  const lateSave = deferred()
  const accessErrors = []
  let mode = 'error'
  const repository = {
    load: async (engagementId) => ({ ...emptySnapshot(), artifacts: emptySnapshot().artifacts.map(item => ({ ...item, engagement_id: engagementId })) }),
    saveDraft: async () => mode === 'error'
      ? Promise.reject(Object.assign(new Error('Plan permission revoked'), { status: 403, membershipMismatch: true }))
      : lateSave.promise,
  }
  const props = campaign => ({
    organizationId: 'org-a', engagement: { id: `eng-${campaign}`, name: `Engagement ${campaign}` },
    campaign: { id: `campaign-${campaign}`, name: `Campaign ${campaign}`, objective: 'Objective', planned_channels: ['Email'] },
    repository, canEdit: true, onAccessError: error => accessErrors.push(error.message),
  })
  await act(async () => root.render(createElement(MarketingCampaignPlan, props('a'))))
  await act(async () => elements(environment.container, 'form')[0].dispatchEvent(new TestEvent('submit', { bubbles: true })))
  assert.match(environment.container.textContent, /Plan permission revoked/)
  assert.deepEqual(accessErrors, ['Plan permission revoked'])

  mode = 'late'
  await act(async () => elements(environment.container, 'form')[0].dispatchEvent(new TestEvent('submit', { bubbles: true })))
  await act(async () => root.render(createElement(MarketingCampaignPlan, props('b'))))
  assert.match(environment.container.textContent, /Campaign b/i)
  await act(async () => lateSave.resolve({ id: 'late-v1', version_number: 1 }))
  assert.doesNotMatch(environment.container.textContent, /Saved unapproved plan version/)
  assert.match(environment.container.textContent, /Campaign b/i)
})

test('mounted plan keeps read-only and stale-source states non-saveable', async t => {
  const { MarketingCampaignPlan, environment, root } = await mountedComponent(t)
  let saves = 0
  const snapshot = emptySnapshot()
  snapshot.versions = [{
    id: 'plan-v1', organization_id: 'org-a', engagement_id: 'eng-a', campaign_id: 'campaign-a', version_number: 1,
    lifecycle_status: 'draft', title: 'Saved', objective: 'Objective', channels: ['Email'],
    approved_message_version_id: 'revoked-message', created_at: '2026-09-11T12:00:00Z',
  }]
  const repository = { load: async () => snapshot, saveDraft: async () => { saves += 1 } }
  const props = {
    organizationId: 'org-a', engagement: { id: 'eng-a', name: 'Engagement A' },
    campaign: { id: 'campaign-a', name: 'Campaign A' }, repository, onAccessError: () => {},
  }
  await act(async () => root.render(createElement(MarketingCampaignPlan, { ...props, canEdit: true })))
  assert.match(environment.container.textContent, /previously selected source is no longer readable or eligible/)
  assert.equal(byText(environment.container, 'button', 'Save unapproved version').disabled, true)
  await act(async () => root.render(createElement(MarketingCampaignPlan, { ...props, canEdit: false })))
  assert.match(environment.container.textContent, /Read only/)
  assert.equal(byLabel(environment.container, 'Plan title').disabled, true)
  assert.equal(saves, 0)
})
