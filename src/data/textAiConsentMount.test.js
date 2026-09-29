import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'
import { mountedEnvironment, elements } from './testSupport/designVideoDom.js'
import { textAiConsentKey } from './textAiConsent.js'
const props = node => node[Object.keys(node).find(key => key.startsWith('__reactProps$'))]

test('mounted consent only dispatches on Ask and confirmation; renews every changed scope and cancels stale requests', async t => {
  const env = mountedEnvironment()
  const values = { document: env.document, window: env.window, Node: env.window.Node, HTMLElement: env.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true }
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, globalThis[key]]))
  Object.assign(globalThis, values)
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
  const { default: Dialog, useTextAiConsent } = await vite.ssrLoadModule('/src/components/TextAiConsent.jsx')
  const root = createRoot(env.container)
  t.after(async () => { await act(async () => root.unmount()); await vite.close(); Object.assign(globalThis, previous) })
  let calls = 0
  function Harness({ scope, ready = true }) {
    const consent = useTextAiConsent(textAiConsentKey(scope))
    return createElement('div', null,
      createElement('button', { onClick: async () => { if (ready && await consent.confirm()) calls++ } }, 'Ask'),
      consent.dialog && createElement(Dialog, { ...consent.dialog, provider: 'OpenAI', model: 'Approved model', scope: 'This conversation' }))
  }
  const scope = { userId: 'actor', organizationId: 'org', departmentId: 'design', projectId: 'project', engagementId: 'engagement', contextKind: 'engagement', conversationId: 'conversation', connectionId: 'connection', provider: 'openai', canonical: false, recipients: [], sources: [], selectedAttachmentIds: [] }
  const render = (value, ready = true) => act(async () => root.render(createElement(Harness, { scope: value, ready })))
  const button = label => elements(env.container, 'button').find(node => node.textContent === label)
  const click = label => act(async () => { void props(button(label)).onClick() })
  await render(scope)
  assert.equal(calls, 0)
  await click('Ask'); assert.equal(calls, 0)
  await click('Cancel'); assert.equal(calls, 0)
  await click('Ask'); await click('Allow and ask Anka AI'); assert.equal(calls, 1)
  await render({ ...scope, message: 'Another human message' }); await click('Ask'); assert.equal(calls, 2)
  await render({ ...scope, modelId: 'another-approved-model' }); await click('Ask'); assert.equal(calls, 3)
  await render(scope, false); await click('Ask'); assert.equal(calls, 3)
  await render(scope, true); await click('Ask'); assert.equal(calls, 4)
  assert.equal(button('Allow and ask Anka AI'), undefined)
  let count = calls
  for (const [field, value] of Object.entries(scope)) {
    const changed = { ...scope, [field]: Array.isArray(value) ? ['changed'] : typeof value === 'boolean' ? !value : value + '2' }
    await render(changed); await click('Ask'); assert.equal(calls, count, field)
    assert.ok(button('Allow and ask Anka AI'), field)
    await click('Allow and ask Anka AI'); assert.equal(calls, ++count)
  }
  await render(scope); await click('Ask')
  await render({ ...scope, conversationId: 'changed-before-confirmation' })
  assert.equal(button('Allow and ask Anka AI'), undefined)
  assert.equal(calls, count)
  await render(scope)
  assert.equal(button('Allow and ask Anka AI'), undefined, 'returning to a scope cannot resurrect a cancelled dialog')
  await render(scope, false); await click('Ask')
  assert.equal(button('Allow and ask Anka AI'), undefined)
  assert.equal(calls, count)
  await render(scope); await click('Ask'); await click('Allow and ask Anka AI'); count++
  await act(async () => root.render(null))
  await render(scope); await click('Ask')
  assert.equal(calls, count)
  assert.ok(button('Allow and ask Anka AI'), 'unmount clears the grant')
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
  assert.match(engagement, /Only validated text from selected TXT\/MD\/DOCX files is sent/)
  assert.match(engagement, /PNG\/JPEG are reference-only and are never sent/)
  assert.match(engagement, /PDF and scanned\/OCR documents remain unavailable/)
  assert.doesNotMatch(engagement, /30 minutes|No additional sources or files/)
  const filesOnly = renderToStaticMarkup(createElement(Dialog, { ...shared, engagementHistory: true, selectedAttachmentIds: ['file'] }))
  assert.match(filesOnly, /Only validated text from selected/)
  assert.doesNotMatch(filesOnly, /No files are included|No additional sources or files/)
  const imagesOnly = renderToStaticMarkup(createElement(Dialog, { ...shared, engagementHistory: true, selectedAttachmentIds: ['png', 'jpeg'] }))
  assert.match(imagesOnly, /selecting other file types does not include text/)
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
