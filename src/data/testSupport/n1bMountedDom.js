// Minimal synthetic DOM adapted from the existing department workshop harness.
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

export function mountedEnvironment() {
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
