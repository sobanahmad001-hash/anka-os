import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'
import { createDepartmentChatRepository } from '../data/departmentChatTransport.js'
import { readPositioningStageOutput } from '../data/positioningStageOutput.js'

export default function ServiceStructureOutput({ scope, phase, busy, canManage, signal, client = supabase, renderKeywordInput }) {
  const { organizationId, projectId, engagementId, actorId } = scope
  const keyword = phase === 'website.keywords'
  const storageKey = ['anka:service-structure', organizationId, projectId, engagementId, actorId].join(':')
  const [state, setState] = useState(null)
  const [review, setReview] = useState(null)
  const [sourceId, setSourceId] = useState('')
  const [approvalId, setApprovalId] = useState('')
  const [wording, setWording] = useState('')
  const [attested, setAttested] = useState(false)
  const [selected, setSelected] = useState(null)
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)
  const [pending, setPending] = useState(null)
  const controller = useRef(null)
  const flight = useRef(false)
  const args = { p_organization_id: organizationId, p_project_id: projectId, p_engagement_id: engagementId }
  async function rpc(name, fields, abort) {
    const { data, error: failure } = await client.rpc(name, { ...args, ...fields }).abortSignal(abort)
    abort.throwIfAborted()
    if (failure) throw Object.assign(new Error(failure.message), { code: failure.code })
    return data
  }
  async function read(conversationId, versionId, abort) {
    const data = await rpc('read_project_service_structure_output', { p_conversation_id: conversationId, p_version_id: versionId }, abort)
    if (!data || data.actor_id !== actorId || data.organization_id !== organizationId || data.project_id !== projectId || data.engagement_id !== engagementId) throw Error('Project scope changed.')
    return data
  }
  async function refresh(abort) {
    const [positioning, structure] = await Promise.all([readPositioningStageOutput(client, scope, abort), read(null, null, abort)])
    abort.throwIfAborted()
    setState({ positioning, structure })
  }
  useEffect(() => {
    const life = new AbortController()
    controller.current = life
    const stop = () => life.abort()
    signal?.addEventListener('abort', stop, { once: true })
    if (signal?.aborted) stop()
    try {
      setPending(JSON.parse(localStorage.getItem(storageKey)))
      refresh(life.signal).catch(e => { if (!life.signal.aborted) setError(e.message) })
    } catch { setError('Original service structure recovery is unavailable.'); setPending({ invalid: true }) }
    return () => { stop(); signal?.removeEventListener('abort', stop) }
  }, [storageKey, signal, client]) // eslint-disable-line react-hooks/exhaustive-deps
  const positioning = state?.positioning.current
  const version = state?.structure.current
  const current = positioning?.conversation_id && positioning.binding_id === state?.positioning.bindingId && positioning.version_id === state?.structure.positioning_version_id
  const source = review?.messages.find(m => m.id === sourceId)
  async function act(fn) {
    if (busy || flight.current || !controller.current || controller.current.signal.aborted) return
    const abort = controller.current.signal
    flight.current = true; setWorking(true); setError('')
    try { await fn(abort) } catch (e) { if (!abort.aborted) setError(e.message) }
    finally { flight.current = false; if (!abort.aborted) setWorking(false) }
  }
  async function openReview(abort, older = false) {
    const chat = createDepartmentChatRepository(client)
    const id = positioning.conversation_id
    const opts = { organizationId, signal: abort }
    const access = await chat.getContextConversation({ conversation_id: id, send_access_only: true }, opts)
    if (access?.conversation?.owner_id !== actorId || access.conversation.project_id !== projectId || access.conversation.organization_id !== organizationId || access.conversation.context_kind !== 'project_team' || access.conversation.id !== id || access.recipients?.length !== 0) throw Error('Open the original private Project Chat.')
    const page = await chat.getContextConversation({ conversation_id: id, ...(older ? { before_sequence: review.first } : {}) }, opts)
    abort.throwIfAborted()
    if (page?.conversation?.id !== id || !Array.isArray(page.messages)) throw Error('Conversation changed.')
    const messages = page.messages.filter(m => m.conversation_id === id && m.status === 'completed' && (m.role === 'assistant' || (m.role === 'user' && m.author_id === actorId)))
    setReview({ messages: older ? [...messages, ...review.messages] : messages, first: page.messages[0]?.sequence, older: page.has_older })
  }
  function clearPending() { localStorage.removeItem(storageKey); setPending(null) }
  async function save(abort) {
    if (!attested || !wording.trim() || !source?.body.includes(wording) || !approvalId || pending) return
    const request = { id: crypto.randomUUID(), conversation: positioning.conversation_id }
    localStorage.setItem(storageKey, JSON.stringify(request)); setPending(request)
    let receipt
    try {
      receipt = await rpc('save_project_service_structure_output', { p_conversation_id: request.conversation, p_request_id: request.id, p_positioning_version_id: positioning.version_id, p_expected_version_id: version?.version_id || null, p_source_message_id: sourceId, p_approval_message_id: approvalId, p_attested: true, p_wording: wording }, abort)
    } catch (e) { if (['22023','42501','23505','40001'].includes(e.code)) clearPending(); throw e }
    if (receipt?.version_id !== request.id || receipt.conversation_id !== request.conversation) throw Error('Check the original save.')
    clearPending(); setReview(null); setAttested(false); setWording(''); setSelected(null)
    await refresh(abort)
  }
  async function recover(abort) {
    const row = await rpc('recover_project_service_structure_output', { p_conversation_id: pending.conversation, p_request_id: pending.id }, abort)
    if (row?.version_id !== pending.id || row.conversation_id !== pending.conversation) throw Error('No matching saved version was found at this check.')
    clearPending(); setReview(null); await refresh(abort)
  }
  async function retrieveExact(abort) {
    const result = await read(version.conversation_id, version.version_id, abort)
    const row = result.selected
    if (row?.version_id !== version.version_id || row.conversation_id !== version.conversation_id || row.wording_sha256 !== version.wording_sha256 || typeof row.wording !== 'string') throw Error('Exact version unavailable.')
    if (keyword && (result.current?.version_id !== row.version_id || result.positioning_version_id !== row.positioning_version_id)) throw Error('Review the latest service structure before choosing a keyword input.')
    if (keyword) {
      const fresh = await readPositioningStageOutput(client, scope, abort)
      if (fresh.current?.version_id !== row.positioning_version_id || fresh.current.binding_id !== fresh.bindingId) throw Error('Positioning or its brief changed. Review the current service structure.')
    }
    return row
  }
  async function retrieve(abort) {
    setSelected(null)
    setSelected(await retrieveExact(abort))
  }
  const disabled = busy || working
  return <section aria-label={keyword ? 'Service structure input' : 'Product and service structure output'}>
    <h5>{keyword ? 'Service structure input' : 'Product and service structure output'}</h5>
    {version ? <p>Saved service structure v{version.version_number}. Stage completion is tracked separately.</p> : state && <p>No service structure version saved.</p>}
    {version?.conversation_id && <button type="button" disabled={disabled || (keyword && (!current || positioning.version_id !== version.positioning_version_id))} onClick={() => act(retrieve)}>{keyword ? 'Use this version as keyword research input' : 'Read saved service structure'}</button>}
    {selected && <div><strong>{keyword ? 'Selected keyword research input' : 'Saved wording'} · v{selected.version_number}</strong><pre>{selected.wording}</pre></div>}
    {keyword && selected && current && selected.version_id === version?.version_id && renderKeywordInput?.(selected, positioning.binding_id, () => retrieveExact(controller.current.signal))}
    {!keyword && canManage && current && !review && !pending && <button type="button" disabled={disabled} onClick={() => act(openReview)}>Review service structure from private Chat</button>}
    {review && !pending && <fieldset disabled={disabled}><legend>Review exact service structure</legend>
      {review.older && <button type="button" onClick={() => act(abort => openReview(abort,true))}>Load earlier messages</button>}
      <label>Saved source message<select value={sourceId} onChange={e => { setSourceId(e.target.value); setApprovalId(''); setWording(''); setAttested(false) }}><option value="">Choose a message</option>{review.messages.map(m => <option key={m.id} value={m.id}>{m.role} #{m.sequence}</option>)}</select></label>
      {source && <><label>Source wording<textarea readOnly value={source.body} onSelect={e => { setWording(source.body.slice(e.target.selectionStart,e.target.selectionEnd)); setAttested(false) }}/></label><p>Select the exact five-service passage to save.</p><pre>{wording}</pre>
      <label>Saved owner approval<select value={approvalId} onChange={e => { setApprovalId(e.target.value); setAttested(false) }}><option value="">Choose the owner message</option>{review.messages.filter(m => m.role === 'user' && m.author_id === actorId && m.sequence >= source.sequence).map(m => <option key={m.id} value={m.id}>Your message #{m.sequence}</option>)}</select></label>
      <pre>{review.messages.find(m => m.id === approvalId)?.body}</pre>
      <label><input type="checkbox" checked={attested} onChange={e => setAttested(e.target.checked)}/>I confirm this owner message approves the five services exactly as selected.</label>
      <button type="button" disabled={!approvalId || !wording.trim() || !attested} onClick={() => act(save)}>Save reviewed service structure</button></>}
      <button type="button" onClick={() => { setReview(null); setSourceId(''); setApprovalId(''); setWording(''); setAttested(false) }}>Cancel review</button>
    </fieldset>}
    {pending && <button type="button" disabled={disabled || pending.invalid} onClick={() => act(recover)}>Check original service structure save</button>}
    {error && <p role="alert">{error}</p>}
  </section>
}
