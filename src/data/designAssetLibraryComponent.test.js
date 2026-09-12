import assert from 'node:assert/strict'
import test from 'node:test'
import { Buffer } from 'node:buffer'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
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
  setAttribute(name, value) { this.attributes.set(name, String(value)); if (name === 'value') this.value = String(value) }
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
  const timers = new Set()
  const window = { document, addEventListener() {}, removeEventListener() {}, getSelection: () => null, setTimeout(callback, delay) { const timer = { callback, delay }; timers.add(timer); return timer }, clearTimeout(timer) { timers.delete(timer) }, Event: TestEvent, Node: TestNode, Element: TestElement, HTMLElement: TestElement, HTMLIFrameElement: class extends TestElement {}, SVGElement: TestElement }
  document.defaultView = window
  return { document, window, container: document.createElement('div'), runTimers() { for (const timer of [...timers]) { timers.delete(timer); timer.callback() } } }
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

function workspace(requestedAt) {
  return {
    engagement: { id: 'engagement-a' }, mediaUrlsRequestedAt: requestedAt, mediaUrlExpiresIn: 300, mediaUrlOrigin: 'https://project.supabase.co',
    sessions: [{ id: 'session-a', output_goal: 'Launch assets' }], directions: [{ id: 'direction-a', session_id: 'session-a' }],
    directionVersions: [{ id: 'version-a', direction_id: 'direction-a', version_number: 1, content: { title: 'Hero asset' } }], experimentalDirectionVersions: [],
    imageGenerationJobs: [{ id: 'job-a', media_asset_id: 'asset-a', model_registry_id: 'model-a', status: 'succeeded' }], models: [{ id: 'model-a', display_name: 'Image model' }], variants: [],
    mediaAssets: [
      { id: 'asset-a', design_direction_version_id: 'version-a', media_type: 'image', status: 'ready', signed_url: 'https://project.supabase.co/storage/v1/object/sign/design/a.png?token=signed', created_at: '2026-09-11T11:00:00.000Z' },
      { id: 'asset-b', design_direction_version_id: 'version-a', media_type: 'image', status: 'failed', created_at: '2026-09-10T11:00:00.000Z' },
    ],
  }
}

function comparisonWorkspace(requestedAt) {
  const data = workspace(requestedAt)
  data.sessions.push({ id: 'session-b', output_goal: 'Campaign assets' }, { id: 'session-c', output_goal: 'Editorial assets' })
  data.directions.push({ id: 'direction-b', session_id: 'session-b' }, { id: 'direction-c', session_id: 'session-c' })
  data.directionVersions.push(
    { id: 'version-b', direction_id: 'direction-b', version_number: 4, content: { title: 'Campaign output' } },
    { id: 'version-c', direction_id: 'direction-c', version_number: 1, content: { title: 'Editorial output' } },
  )
  data.imageGenerationJobs.push(
    { id: 'job-b', media_asset_id: 'asset-b', model_registry_id: 'model-a', status: 'succeeded' },
    { id: 'job-c', media_asset_id: 'asset-c', model_registry_id: 'model-a', status: 'succeeded' },
  )
  Object.assign(data.mediaAssets[1], { design_direction_version_id: 'version-b', status: 'ready', signed_url: 'https://project.supabase.co/storage/v1/object/sign/design/b.png?token=signed-b' })
  Object.assign(data.mediaAssets[0], { provider: 'openai', generated_by: 'user-a' })
  Object.assign(data.mediaAssets[1], { provider: 'openai', generated_by: 'user-b' })
  data.mediaAssets.push({ id: 'asset-c', design_direction_version_id: 'version-c', media_type: 'image', status: 'ready', signed_url: 'https://project.supabase.co/storage/v1/object/sign/design/c.png?token=signed-c', created_at: '2026-09-11T09:00:00.000Z' })
  return data
}

test('asset library renders its read-only empty state, filters and keyboard controls', async t => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  t.after(() => server.close())
  const { default: DesignAssetLibrary } = await server.ssrLoadModule('/src/components/DesignAssetLibrary.jsx')
  const { default: DesignAssetComparison } = await server.ssrLoadModule('/src/components/DesignAssetComparison.jsx')
  const markup = renderToStaticMarkup(createElement(DesignAssetLibrary, {
    contextKey: 'engagement-a',
    workspace: { engagement: { id: 'engagement-a' }, mediaAssets: [], imageGenerationJobs: [], directionVersions: [], experimentalDirectionVersions: [], directions: [], sessions: [], models: [], variants: [], mediaUrlExpiresIn: 300 },
    onClose: () => {}, onFocusSource: () => {},
  }))
  assert.match(markup, /Design S05 · Versioned assets/)
  assert.match(markup, /No assets yet/)
  assert.match(markup, /All statuses/)
  assert.match(markup, /All sources/)
  assert.match(markup, /Any date/)
  assert.match(markup, /aria-pressed="true"/)
  const comparisonMarkup = renderToStaticMarkup(createElement(DesignAssetComparison, { rows: [], contextKey: 'engagement-a', accessOptions: {}, onClose: () => {}, onFocusSource: () => {} }))
  assert.match(comparisonMarkup, /Two outputs are required/)
  assert.match(comparisonMarkup, /does not establish asset version lineage/)
  assert.match(markup, /Upload asset/)
  assert.doesNotMatch(markup, /Authorized draft upload|Approve asset|Archive asset|Generate image/)
})

test('mounted library uploads an exact PNG draft payload and clears the form on context change', async t => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  t.after(() => server.close())
  const { default: DesignAssetLibrary } = await server.ssrLoadModule('/src/components/DesignAssetLibrary.jsx')
  const environment = mountedEnvironment()
  const previous = { document: globalThis.document, window: globalThis.window, Event: globalThis.Event, Node: globalThis.Node, HTMLElement: globalThis.HTMLElement, act: globalThis.IS_REACT_ACT_ENVIRONMENT }
  Object.assign(globalThis, { document: environment.document, window: environment.window, Event: TestEvent, Node: TestNode, HTMLElement: TestElement, IS_REACT_ACT_ENVIRONMENT: true })
  t.after(() => Object.assign(globalThis, { document: previous.document, window: previous.window, Event: previous.Event, Node: previous.Node, HTMLElement: previous.HTMLElement, IS_REACT_ACT_ENVIRONMENT: previous.act }))
  const requestedAt = Date.now()
  const data = workspace(requestedAt)
  data.engagement.brand_id = 'brand-a'
  data.designAssets = []
  data.designAssetVersions = []
  const uploads = []
  const props = { workspace: data, contextKey: 'context-a', canUpload: true, busy: false, onUpload: input => { uploads.push(input); return Promise.resolve({}) }, onClose: () => {}, onFocusSource: () => {} }
  const root = createRoot(environment.container)
  t.after(() => { try { root.unmount() } catch { /* already unmounted */ } })

  await act(async () => root.render(createElement(DesignAssetLibrary, props)))
  await act(async () => byText(environment.container, 'button', 'Upload asset').dispatchEvent(new TestEvent('click', { bubbles: true })))
  assert.match(environment.container.textContent, /Authorized draft upload/)
  const fileInput = elements(environment.container, 'input')[0]
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n9sAAAAASUVORK5CYII=', 'base64')
  fileInput.files = [{ name: 'hero.png', type: 'image/png', size: png.length, arrayBuffer: async () => png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) }]
  await act(async () => fileInput.dispatchEvent(new TestEvent('change', { bubbles: true })))
  await act(async () => elements(environment.container, 'form')[0].dispatchEvent(new TestEvent('submit', { bubbles: true })))
  assert.equal(uploads.length, 1, environment.container.textContent)
  assert.equal(uploads[0].engagement_id, 'engagement-a')
  assert.equal(uploads[0].brand_id, 'brand-a')
  assert.equal(uploads[0].mime_type, 'image/png')
  assert.equal(uploads[0].original_filename, 'hero.png')
  assert.ok(uploads[0].file_base64.length > 20)
  assert.ok(uploads[0].operation_key)

  await act(async () => root.render(createElement(DesignAssetLibrary, { ...props, contextKey: 'context-b' })))
  assert.doesNotMatch(environment.container.textContent, /Authorized draft upload/)
})

test('mounted library selects, filters, clears, focuses source, resets context and expires links', async t => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  t.after(() => server.close())
  const { default: DesignAssetLibrary } = await server.ssrLoadModule('/src/components/DesignAssetLibrary.jsx')
  const environment = mountedEnvironment()
  const previous = { document: globalThis.document, window: globalThis.window, Event: globalThis.Event, Node: globalThis.Node, HTMLElement: globalThis.HTMLElement, act: globalThis.IS_REACT_ACT_ENVIRONMENT }
  Object.assign(globalThis, { document: environment.document, window: environment.window, Event: TestEvent, Node: TestNode, HTMLElement: TestElement, IS_REACT_ACT_ENVIRONMENT: true })
  t.after(() => Object.assign(globalThis, { document: previous.document, window: previous.window, Event: previous.Event, Node: previous.Node, HTMLElement: previous.HTMLElement, IS_REACT_ACT_ENVIRONMENT: previous.act }))
  const requestedAt = Date.parse('2026-09-11T12:00:00.000Z')
  let clock = requestedAt + 294000
  const originalNow = Date.now
  Date.now = () => clock
  t.after(() => { Date.now = originalNow })
  const focused = []
  const props = { workspace: workspace(requestedAt), contextKey: 'context-a', onClose: () => {}, onFocusSource: row => focused.push(row.id) }
  const root = createRoot(environment.container)
  t.after(() => { try { root.unmount() } catch { /* already unmounted */ } })

  await act(async () => root.render(createElement(DesignAssetLibrary, props)))
  assert.equal(elements(environment.container, 'img').length, 1)
  await act(async () => byText(environment.container, 'button', 'Compare two outputs').dispatchEvent(new TestEvent('click', { bubbles: true })))
  assert.ok(byText(environment.container, 'h3', 'Compare two outputs'))
  await act(async () => byText(environment.container, 'button', 'Close comparison').dispatchEvent(new TestEvent('click', { bubbles: true })))
  await act(async () => byText(environment.container, 'button', 'View detail').dispatchEvent(new TestEvent('click', { bubbles: true })))
  assert.ok(byText(environment.container, 'a', 'Open or save signed image'))
  await act(async () => byText(environment.container, 'button', 'Open source in Design desk').dispatchEvent(new TestEvent('click', { bubbles: true })))
  assert.deepEqual(focused, ['asset-a'])

  const status = elements(environment.container, 'select')[0]
  status.value = 'failed'
  await act(async () => status.dispatchEvent(new TestEvent('change', { bubbles: true })))
  assert.match(environment.container.textContent, /1 of 2 authorized assets/)
  await act(async () => byText(environment.container, 'button', 'Clear filters').dispatchEvent(new TestEvent('click', { bubbles: true })))
  assert.match(environment.container.textContent, /2 of 2 authorized assets/)

  await act(async () => root.render(createElement(DesignAssetLibrary, { ...props, contextKey: 'context-b' })))
  assert.equal(byText(environment.container, 'h3', 'Selected asset'), undefined)
  assert.equal(elements(environment.container, 'select')[0].value, 'all')

  clock += 1001
  await act(async () => environment.runTimers())
  assert.equal(elements(environment.container, 'img').length, 0)
  await act(async () => byText(environment.container, 'button', 'View detail').dispatchEvent(new TestEvent('click', { bubbles: true })))
  assert.equal(byText(environment.container, 'a', 'Open or save signed image'), undefined)
  assert.match(environment.container.textContent, /signed image link has expired/)

  const prefixedPathWorkspace = workspace(clock)
  prefixedPathWorkspace.mediaAssets[0].signed_url = 'https://project.supabase.co/prefix/storage/v1/object/sign/design/a.png?token=signed'
  await act(async () => root.render(createElement(DesignAssetLibrary, { ...props, workspace: prefixedPathWorkspace, contextKey: 'context-c' })))
  assert.equal(elements(environment.container, 'img').length, 0)
  await act(async () => byText(environment.container, 'button', 'View detail').dispatchEvent(new TestEvent('click', { bubbles: true })))
  assert.equal(byText(environment.container, 'a', 'Open or save signed image'), undefined)
  assert.match(environment.container.textContent, /signed image link is invalid/)
})

test('mounted library comparison selects, changes, clears, focuses, resets context and expires both outputs', async t => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  t.after(() => server.close())
  const { default: DesignAssetLibrary } = await server.ssrLoadModule('/src/components/DesignAssetLibrary.jsx')
  const environment = mountedEnvironment()
  const previous = { document: globalThis.document, window: globalThis.window, Event: globalThis.Event, Node: globalThis.Node, HTMLElement: globalThis.HTMLElement, act: globalThis.IS_REACT_ACT_ENVIRONMENT }
  Object.assign(globalThis, { document: environment.document, window: environment.window, Event: TestEvent, Node: TestNode, HTMLElement: TestElement, IS_REACT_ACT_ENVIRONMENT: true })
  t.after(() => Object.assign(globalThis, { document: previous.document, window: previous.window, Event: previous.Event, Node: previous.Node, HTMLElement: previous.HTMLElement, IS_REACT_ACT_ENVIRONMENT: previous.act }))
  const requestedAt = Date.parse('2026-09-11T12:00:00.000Z')
  let clock = requestedAt + 294000
  const originalNow = Date.now
  Date.now = () => clock
  t.after(() => { Date.now = originalNow })
  const focused = []
  const props = { workspace: comparisonWorkspace(requestedAt), contextKey: 'context-a', onClose: () => {}, onFocusSource: row => focused.push(row.id) }
  const root = createRoot(environment.container)
  t.after(() => { try { root.unmount() } catch { /* already unmounted */ } })

  await act(async () => root.render(createElement(DesignAssetLibrary, props)))
  await act(async () => byText(environment.container, 'button', 'Compare two outputs').dispatchEvent(new TestEvent('click', { bubbles: true })))
  assert.match(environment.container.textContent, /Choose output A and output B/)
  const outputSelect = label => elements(environment.container, 'select').find(select => select.getAttribute('aria-label') === label)
  outputSelect('Output A').value = 'asset-a'
  await act(async () => outputSelect('Output A').dispatchEvent(new TestEvent('change', { bubbles: true })))
  outputSelect('Output B').value = 'asset-b'
  await act(async () => outputSelect('Output B').dispatchEvent(new TestEvent('change', { bubbles: true })))
  assert.equal(elements(environment.container, 'article').length, 2)
  assert.equal(elements(environment.container, 'img').length, 5)
  assert.match(environment.container.textContent, /v1 · version-a/)
  assert.match(environment.container.textContent, /v4 · version-b/)
  assert.match(environment.container.textContent, /Generated byuser-a/)
  assert.match(environment.container.textContent, /Generated byuser-b/)
  assert.match(environment.container.textContent, /Independent asset versionunknownUnavailable \/ not recordedUnavailable \/ not recorded/)
  assert.match(environment.container.textContent, /does not establish asset version lineage/)
  await act(async () => elements(environment.container, 'button').find(button => button.textContent === 'Open recorded source').dispatchEvent(new TestEvent('click', { bubbles: true })))
  assert.deepEqual(focused, ['asset-a'])

  outputSelect('Output A').value = 'asset-c'
  await act(async () => outputSelect('Output A').dispatchEvent(new TestEvent('change', { bubbles: true })))
  assert.match(environment.container.textContent, /Editorial output/)
  const clearButtons = elements(environment.container, 'button').filter(button => button.textContent === 'Clear')
  await act(async () => clearButtons[0].dispatchEvent(new TestEvent('click', { bubbles: true })))
  assert.match(environment.container.textContent, /Choose output A and output B/)

  outputSelect('Output A').value = 'asset-a'
  await act(async () => outputSelect('Output A').dispatchEvent(new TestEvent('change', { bubbles: true })))
  await act(async () => byText(environment.container, 'button', 'Clear both outputs').dispatchEvent(new TestEvent('click', { bubbles: true })))
  assert.equal(elements(environment.container, 'article').length, 0)
  outputSelect('Output A').value = 'asset-a'
  await act(async () => outputSelect('Output A').dispatchEvent(new TestEvent('change', { bubbles: true })))
  outputSelect('Output B').value = 'asset-b'
  await act(async () => outputSelect('Output B').dispatchEvent(new TestEvent('change', { bubbles: true })))
  await act(async () => root.render(createElement(DesignAssetLibrary, { ...props, contextKey: 'context-b' })))
  assert.match(environment.container.textContent, /Choose output A and output B/)
  assert.equal(elements(environment.container, 'article').length, 0)
  assert.equal(elements(environment.container, 'img').length, 3)

  outputSelect('Output A').value = 'asset-a'
  await act(async () => outputSelect('Output A').dispatchEvent(new TestEvent('change', { bubbles: true })))
  outputSelect('Output B').value = 'asset-b'
  await act(async () => outputSelect('Output B').dispatchEvent(new TestEvent('change', { bubbles: true })))
  clock += 1001
  await act(async () => environment.runTimers())
  assert.equal(elements(environment.container, 'article').length, 2)
  assert.equal(elements(environment.container, 'img').length, 0)
  assert.equal(elements(environment.container, 'a').filter(link => link.textContent === 'Open or save signed image').length, 0)
  assert.equal((environment.container.textContent.match(/signed image link has expired/g) || []).length, 2)
})

test('mounted asset detail browses and compares two true versions of one asset', async t => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  t.after(() => server.close())
  const { default: DesignAssetLibrary } = await server.ssrLoadModule('/src/components/DesignAssetLibrary.jsx')
  const environment = mountedEnvironment()
  const previous = { document: globalThis.document, window: globalThis.window, Event: globalThis.Event, Node: globalThis.Node, HTMLElement: globalThis.HTMLElement, act: globalThis.IS_REACT_ACT_ENVIRONMENT }
  Object.assign(globalThis, { document: environment.document, window: environment.window, Event: TestEvent, Node: TestNode, HTMLElement: TestElement, IS_REACT_ACT_ENVIRONMENT: true })
  t.after(() => Object.assign(globalThis, { document: previous.document, window: previous.window, Event: previous.Event, Node: previous.Node, HTMLElement: previous.HTMLElement, IS_REACT_ACT_ENVIRONMENT: previous.act }))
  const requestedAt = Date.now()
  const data = workspace(requestedAt)
  data.designAssets = [{ id: 'design-asset-a', name: 'Hero master', placement: 'Homepage', rights_notes: '', created_at: '2026-09-11T10:00:00.000Z' }]
  data.designAssetVersions = [
    { id: 'asset-version-2', asset_id: 'design-asset-a', version_number: 2, parent_version_id: 'asset-version-1', source_kind: 'upload', source_direction_version_id: 'version-a', lifecycle_status: 'draft', mime_type: 'image/png', width: 1600, height: 900, original_filename: 'hero-v2.png', change_summary: 'Adjusted crop', signed_url: 'https://project.supabase.co/storage/v1/object/sign/design/v2.png?token=v2', created_by: 'user-a', created_at: '2026-09-11T11:00:00.000Z' },
    { id: 'asset-version-1', asset_id: 'design-asset-a', version_number: 1, parent_version_id: null, source_kind: 'generated', source_media_asset_id: 'asset-a', source_direction_version_id: 'version-a', lifecycle_status: 'draft', mime_type: 'image/png', original_filename: 'generated.png', signed_url: 'https://project.supabase.co/storage/v1/object/sign/design/v1.png?token=v1', created_by: 'user-a', created_at: '2026-09-11T10:00:00.000Z' },
  ]
  const root = createRoot(environment.container)
  t.after(() => { try { root.unmount() } catch { /* already unmounted */ } })
  await act(async () => root.render(createElement(DesignAssetLibrary, { workspace: data, contextKey: 'context-a', onClose: () => {}, onFocusSource: () => {} })))
  await act(async () => byText(environment.container, 'button', 'View detail').dispatchEvent(new TestEvent('click', { bubbles: true })))
  assert.match(environment.container.textContent, /Immutable file history/)
  assert.match(environment.container.textContent, /v2 · asset-version-2/)
  assert.match(environment.container.textContent, /v1 · asset-version-1/)
  assert.match(environment.container.textContent, /Adjusted crop/)
  assert.equal(elements(environment.container, 'article').length, 2)
  const versionB = elements(environment.container, 'select').find(select => select.getAttribute('aria-label') === 'Asset version B')
  versionB.value = 'asset-version-2'
  await act(async () => versionB.dispatchEvent(new TestEvent('change', { bubbles: true })))
  assert.match(environment.container.textContent, /Choose two distinct versions of this asset/)
  versionB.value = 'asset-version-1'
  await act(async () => versionB.dispatchEvent(new TestEvent('change', { bubbles: true })))
  const versionA = elements(environment.container, 'select').find(select => select.getAttribute('aria-label') === 'Asset version A')
  versionA.value = 'asset-version-2'
  await act(async () => versionA.dispatchEvent(new TestEvent('change', { bubbles: true })))
  assert.equal(elements(environment.container, 'a').filter(link => link.textContent.includes('Open or download exact')).length, 2)
})

test('mounted archive confirmation cancels without a call, retries lost response with one key, and resets on context change', async t => {
  const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  t.after(() => server.close())
  const { default: DesignAssetLibrary } = await server.ssrLoadModule('/src/components/DesignAssetLibrary.jsx')
  const environment = mountedEnvironment()
  const previous = { document: globalThis.document, window: globalThis.window, Event: globalThis.Event, Node: globalThis.Node, HTMLElement: globalThis.HTMLElement, act: globalThis.IS_REACT_ACT_ENVIRONMENT }
  Object.assign(globalThis, { document: environment.document, window: environment.window, Event: TestEvent, Node: TestNode, HTMLElement: TestElement, IS_REACT_ACT_ENVIRONMENT: true })
  t.after(() => Object.assign(globalThis, { document: previous.document, window: previous.window, Event: previous.Event, Node: previous.Node, HTMLElement: previous.HTMLElement, IS_REACT_ACT_ENVIRONMENT: previous.act }))
  const data = workspace(Date.now())
  data.designAssets = [{ id: 'archive-root', name: 'Standalone draft', archived_at: null, created_at: '2026-09-12T10:00:00.000Z' }]
  data.designAssetVersions = [{ id: 'archive-version', asset_id: 'archive-root', version_number: 1, parent_version_id: null, source_kind: 'upload', source_media_asset_id: null, source_direction_version_id: null, lifecycle_status: 'draft', mime_type: 'image/png', original_filename: 'draft.png', signed_url: 'https://project.supabase.co/storage/v1/object/sign/design/draft.png?token=draft', created_by: 'user-a', created_at: '2026-09-12T10:00:00.000Z' }]
  const calls = []
  let confirm = false
  environment.window.confirm = () => confirm
  const root = createRoot(environment.container)
  t.after(() => { try { root.unmount() } catch { /* already unmounted */ } })
  const props = { workspace: data, contextKey: 'context-a', canArchive: true, onArchive: async (row, key) => { calls.push([row.assetVersionId, key]); return false }, onClose: () => {}, onFocusSource: () => {} }

  await act(async () => root.render(createElement(DesignAssetLibrary, props)))
  await act(async () => byText(environment.container, 'button', 'View detail').dispatchEvent(new TestEvent('click', { bubbles: true })))
  await act(async () => byText(environment.container, 'button', 'Archive draft asset').dispatchEvent(new TestEvent('click', { bubbles: true })))
  assert.equal(calls.length, 0)
  confirm = true
  await act(async () => byText(environment.container, 'button', 'Archive draft asset').dispatchEvent(new TestEvent('click', { bubbles: true })))
  await act(async () => byText(environment.container, 'button', 'Archive draft asset').dispatchEvent(new TestEvent('click', { bubbles: true })))
  assert.equal(calls.length, 2)
  assert.equal(calls[0][1], calls[1][1])

  const changedSnapshot = { ...data, designAssetVersions: [{ ...data.designAssetVersions[0], id: 'archive-version-2', version_number: 2, parent_version_id: 'archive-version' }] }
  await act(async () => root.render(createElement(DesignAssetLibrary, { ...props, workspace: changedSnapshot })))
  await act(async () => byText(environment.container, 'button', 'Archive draft asset').dispatchEvent(new TestEvent('click', { bubbles: true })))
  assert.notEqual(calls[2][1], calls[1][1])

  await act(async () => root.render(createElement(DesignAssetLibrary, { ...props, contextKey: 'context-b' })))
  await act(async () => byText(environment.container, 'button', 'View detail').dispatchEvent(new TestEvent('click', { bubbles: true })))
  await act(async () => byText(environment.container, 'button', 'Archive draft asset').dispatchEvent(new TestEvent('click', { bubbles: true })))
  assert.notEqual(calls[3][1], calls[2][1])
})
