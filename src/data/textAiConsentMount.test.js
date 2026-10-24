import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'
import { mountedEnvironment, elements } from './testSupport/designVideoDom.js'
import { textAiConsentKey } from './textAiConsent.js'
const props = node => node[Object.keys(node).find(key => key.startsWith('__reactProps$'))]

test('explicit text Send dispatches once without a dialog; exact additional-source approvals persist and stale dialogs cannot dispatch', async t => {
  const env = mountedEnvironment()
  const store = new Map()
  const values = { document: env.document, window: env.window, Node: env.window.Node, HTMLElement: env.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true, sessionStorage: { getItem: k => store.get(k), setItem: (k, v) => store.set(k, v) } }
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, globalThis[key]]))
  Object.assign(globalThis, values)
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  const { default: Dialog, useTextAiConsent } = await vite.ssrLoadModule('/src/components/TextAiConsent.jsx')
  const root = createRoot(env.container)
  t.after(async () => { await act(async () => root.unmount()); await vite.close(); Object.assign(globalThis, previous) })
  let calls = 0
  function Harness({ scope, ready = true }) {
    const consent = useTextAiConsent(textAiConsentKey(scope))
    return createElement('div', null, createElement('button', { onClick: async () => { if (ready && await consent.confirm()) calls++ } }, 'Ask'), consent.dialog && createElement(Dialog, { ...consent.dialog, provider: 'OpenAI', model: 'Approved model', scope: 'This conversation' }))
  }
  const plain = { userId: 'actor', organizationId: 'org', departmentId: 'design', projectId: 'project', contextKind: 'engagement', conversationId: 'conversation', connectionId: 'connection', provider: 'openai' }
  const render = (scope, ready = true) => act(async () => root.render(createElement(Harness, { scope, ready })))
  const button = label => elements(env.container, 'button').find(node => node.textContent === label)
  const click = label => act(async () => { void props(button(label)).onClick() })
  await render(plain); assert.equal(calls, 0)
  await click('Ask'); assert.equal(calls, 1); assert.equal(button('Allow and ask Anka AI'), undefined)
  await render(plain, false); await click('Ask'); assert.equal(calls, 1)
  const files = { ...plain, selectedAttachmentIds: ['immutable-file'] }
  await render(files); await click('Ask'); assert.equal(calls, 1)
  await click('Allow and ask Anka AI'); assert.equal(calls, 2)
  await act(async () => root.render(null)); await render(files); await click('Ask'); assert.equal(calls, 3)
  assert.equal(button('Allow and ask Anka AI'), undefined)
  await render({ ...files, provider: 'another-provider' }); await click('Ask'); assert.equal(calls, 3)
  const oldAccept = props(button('Allow and ask Anka AI')).onClick
  await render({ ...files, selectedAttachmentIds: ['new-file'] }); await act(async () => oldAccept())
  assert.equal(calls, 3); assert.equal(button('Allow and ask Anka AI'), undefined)
  await click('Ask'); await click('Cancel'); assert.equal(calls, 3)
  await click('Ask'); await click('Allow and ask Anka AI'); assert.equal(calls, 4)
})

test('consent disclosures distinguish engagement history from bounded canonical context', async t => {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  t.after(() => vite.close())
  const { renderToStaticMarkup } = await import('react-dom/server')
  const { default: Dialog } = await vite.ssrLoadModule('/src/components/TextAiConsent.jsx')
  const shared = { provider: 'OpenAI', model: 'Approved model', scope: 'This conversation' }
  const engagement = renderToStaticMarkup(createElement(Dialog, { ...shared, engagementHistory: true, sources: true, selectedAttachmentIds: ['validated-file'] }))
  assert.match(engagement, /including any participant messages already in it/)
  assert.match(engagement, /Your explicitly selected approved artifact versions/)
  assert.doesNotMatch(engagement, /Teammate-authored messages.*excluded/)
  assert.match(engagement, /Only validated text from selected supported documents is sent/)
  assert.match(engagement, /PNG\/JPEG are reference-only and are never sent/)
  assert.match(engagement, /scanned\/OCR content is not extracted/)
  assert.doesNotMatch(engagement, /30 minutes|No additional sources or files/)
  const filesOnly = renderToStaticMarkup(createElement(Dialog, { ...shared, engagementHistory: true, selectedAttachmentIds: ['file'] }))
  assert.match(filesOnly, /Only validated text from selected/)
  assert.doesNotMatch(filesOnly, /No files are included|No additional sources or files/)
  const imagesOnly = renderToStaticMarkup(createElement(Dialog, { ...shared, engagementHistory: true, selectedAttachmentIds: ['png', 'jpeg'] }))
  assert.match(imagesOnly, /reference-only files do not contribute text/)
  assert.match(imagesOnly, /PNG\/JPEG are reference-only and are never sent/)
  assert.doesNotMatch(imagesOnly, /files is included/)
  const noAttachments = renderToStaticMarkup(createElement(Dialog, { ...shared, engagementHistory: true }))
  assert.match(noAttachments, /No attachments are selected; no attachment content is sent/)
  const canonical = renderToStaticMarkup(createElement(Dialog, { ...shared, canonical: true }))
  assert.match(canonical, /Teammate-authored messages, private files and private memory are excluded/)
  assert.match(canonical, /bounded OpenAI canonical summary/)
  assert.match(canonical, /up to 12 recent completed messages through the selected message/)
  assert.match(canonical, /your messages and verified AI replies/)
  assert.match(canonical, /Record IDs, emails, contact details, task and work-item descriptions, files, transcripts, private memory, and teammate messages are excluded/)
})
