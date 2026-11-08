import { useEffect, useRef, useState } from 'react'
import { sameBinding, sameCheckpoint } from '../data/foundationCheckpointRepository.js'

export async function readWebsiteBrief(repository, scope, signal) {
  const {current_binding: binding} = await repository.read(scope, null, 0, signal)
  if (!binding) throw Error('Bind the existing business brief in Shared foundation first.')
  const {current_binding, selected} = await repository.read(scope, binding.checkpoint_id, 0, signal)
  if (!sameBinding(binding, current_binding) || !sameCheckpoint(binding, selected) || !selected.matches_current_brief)
    throw Error('The bound brief has changed. Review the foundation checkpoint.')
  return {binding, text: selected.brief_text}
}

export default function WebsiteGoals({scope, repository, signal, busy, selection, onSelect, onKeywords}) {
  const [brief, setBrief] = useState(null)
  const [goal, setGoal] = useState(selection?.goal || '')
  const [audience, setAudience] = useState(selection?.audience || '')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  async function review(confirm) {
    setWorking(true)
    setError('')
    try {
      const current = await readWebsiteBrief(repository, scope, signal)
      if (!mounted.current || signal?.aborted) return
      setBrief(current)
      if (confirm) {
        if (!sameBinding(brief?.binding, current.binding) || ![goal,audience].every(value => value.trim() && current.text.includes(value)))
          throw Error('Select both passages from the current bound brief.')
        onSelect({binding: current.binding, goal, audience})
      }
    } catch (cause) {
      if (mounted.current && !signal?.aborted) { onSelect(null); setBrief(null); setError(cause.message) }
    } finally { if (mounted.current) setWorking(false) }
  }
  return <section aria-label="Website goals from the bound brief"><fieldset disabled={busy || working}>
    <button type="button" onClick={() => review(false)}>Read bound business brief</button>
    {brief && <><h5>Brief v{brief.binding.source_version}</h5><pre>{brief.text}</pre>
      <label>Website goal passage<textarea value={goal} onChange={e => {onSelect(null);setGoal(e.target.value)}} /></label>
      <label>Audience passage<textarea value={audience} onChange={e => {onSelect(null);setAudience(e.target.value)}} /></label>
      <button type="button" disabled={![goal,audience].every(v => v.trim() && brief.text.includes(v))} onClick={() => review(true)}>Use these passages in this plan session</button></>}
    {selection && <button type="button" onClick={onKeywords}>Continue to Website keyword research</button>}
    {error && <p role="alert">{error}</p>}
  </fieldset></section>
}
