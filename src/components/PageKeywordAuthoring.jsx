import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {useOrganization} from '../context/OrganizationContext.jsx'
import {useAuth} from '../context/AuthContext.jsx'
import {contentStudio} from '../data/contentStudioRepository.js'
import {projectWebsitePages} from '../data/projectWebsitePages.js'
import {keywordAuthoringKeys, keywordRequestIdentity, matchesKeywordAttempt, readKeywordPage, verifyKeywordReceipt} from '../data/pageKeywordAuthoring.js'
import {ArtifactForm} from '../apps/ContentStudio.jsx'

export default function PageKeywordAuthoring(props) {
  const {activeOrganizationId, requestSignal} = useOrganization()
  const {user} = useAuth()
  const studio = useMemo(() => activeOrganizationId && contentStudio.forOrganization(activeOrganizationId, {signal:requestSignal}), [activeOrganizationId, requestSignal])
  if (!studio || props.actorId !== user?.id || props.asset.organizationId !== activeOrganizationId) return <p role="alert">Reopen this page in its original organization.</p>
  const keys = keywordAuthoringKeys(props.asset, props.actorId)
  return <PageStrategyEditor key={keys.draft} {...props} studio={studio} pages={projectWebsitePages} />
}

export function PageStrategyEditor({asset, actorId, studio, pages, signal, onClose, verifyInputs, Form = ArtifactForm}) {
  const keys = keywordAuthoringKeys(asset, actorId)
  const [source, setSource] = useState(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [attempt, setAttempt] = useState(null)
  const [saved, setSaved] = useState(null)
  const [restored, setRestored] = useState(null)
  const [storageFailed, setStorageFailed] = useState(false)
  const flight = useRef(false)
  const active = useRef(null)
  const identity = keys.draft
  active.current = identity
  const current = () => active.current === identity && !signal?.aborted
  useEffect(() => {
    let live = true
    active.current = identity
    async function open() {
      setAttempt(JSON.parse(sessionStorage.getItem(keys.attempt) || 'null'))
      const exact = await readKeywordPage(asset, studio, pages, signal)
      if (!live || !current()) return
      const draft = JSON.parse(sessionStorage.getItem(keys.draft) || 'null')
      setRestored(draft)
      setSource(exact)
    }
    open().catch(reason => { if (live && current()) setError(reason.message) })
    return () => { live = false; active.current = null }
  }, [identity, studio, pages, signal]) // eslint-disable-line react-hooks/exhaustive-deps -- identity includes the complete page scope

  const retain = useCallback(draft => {
    if (active.current !== identity) return
    try { sessionStorage.setItem(identity, JSON.stringify(draft)); setStorageFailed(false) }
    catch { setStorageFailed(true); setError('Draft storage is unavailable. Keep the editor open.') }
  }, [identity])

  async function saveArtifact(input) {
    if (!current() || sessionStorage.getItem(keys.attempt)) throw Error('Check the original strategy attempt before saving.')
    const fresh = await readKeywordPage(asset, studio, pages, signal)
    if (!current() || fresh.strategy || input.artifact_type !== 'keyword_strategy' || input.artifact_id !== null ||
        input.engagement_id !== asset.engagementId || input.content.source_architecture_version_id !== asset.sourceVersionId ||
        !input.content.keywords?.some(row => row.target_page_key === asset.pageKey)) {
      throw Error('The page or strategy changed. Your draft is retained. Reopen its original project.')
    }
    if (verifyInputs) await verifyInputs()
    if (!current() || sessionStorage.getItem(keys.attempt)) throw Error('Reopen the original page and check any retained attempt.')
    const identity = keywordRequestIdentity(asset, crypto.randomUUID())
    const original = {contractVersion:1, id:identity.request_id, identity, organizationId:asset.organizationId,
      actorId, pageId:asset.id, pageKey:asset.pageKey, input}
    sessionStorage.setItem(keys.attempt, JSON.stringify(original))
    setAttempt(original)
    let result
    try { result = await studio.savePageKeywordStrategy({...input, ...identity}) }
    catch (reason) {
      if (current() && reason.rollbackVerified === true &&
          JSON.parse(sessionStorage.getItem(keys.attempt) || 'null')?.id === original.id) {
        // A verified statement rollback is different from a missing receipt.
        // Restore the editor before allowing a separate explicit retry.
        const draft = JSON.parse(sessionStorage.getItem(keys.draft) || 'null')
        sessionStorage.removeItem(keys.attempt)
        setRestored(draft); setAttempt(null)
        reason.message += ' This save rolled back. Your draft is retained; review it before retrying.'
      }
      throw reason
    }
    return accept(result, original)
  }

  function accept(receipt, original) {
    const result = verifyKeywordReceipt(receipt, original, asset, actorId)
    if (!current()) return
    if (JSON.parse(sessionStorage.getItem(keys.attempt) || 'null')?.id !== original.id) throw Error('Original attempt storage changed.')
    sessionStorage.removeItem(keys.attempt)
    sessionStorage.removeItem(keys.draft)
    if (current()) { setSaved(result); setAttempt(null) }
    return result
  }

  async function checkOriginal() {
    if (!current() || flight.current || !matchesKeywordAttempt(attempt,asset,actorId)) return
    flight.current = true
    setSaving(true)
    setError('')
    try {
      const original = JSON.parse(sessionStorage.getItem(keys.attempt) || 'null')
      if (original?.id !== attempt.id || !matchesKeywordAttempt(original,asset,actorId)) throw Error('Original attempt storage changed.')
      const receipt = await studio.recoverPageKeywordStrategy(keywordRequestIdentity(asset,original.id))
      if (!current()) return
      if (receipt === null) setError('No receipt is visible for the original request. Its draft and attempted save are retained.')
      else accept(receipt, original)
    } catch (reason) { if (current()) setError(reason.message) }
    finally { flight.current = false; if (current()) setSaving(false) }
  }

  async function act(callback) {
    if (!current() || flight.current || attempt || saved || storageFailed) return
    flight.current = true
    setSaving(true)
    setError('')
    try { await callback() } catch (reason) { if (current()) setError(reason.message) }
    finally { flight.current = false; if (current()) setSaving(false) }
  }
  const library = new URLSearchParams({ctxOrg:asset.organizationId, ctxProject:asset.projectId, ctxEngagement:asset.engagementId, ctxWorkshopTab:'library'})
  if (saved) { library.set('artifact',saved.artifact_id); library.set('version',saved.version.id) }
  else if (source?.strategy) library.set('artifact',source.strategy.id)
  return <section aria-label="Author page keyword strategy">
    <h4>Keyword strategy for {asset.title}</h4>
    {error && <p role="alert">{error}</p>}
    {!source && !error && <p role="status">Checking the registered page and approved architecture…</p>}
    {source && <p>Page key {asset.pageKey} · architecture version {source.version.version_number}</p>}
    {saving && <p role="status">Checking the strategy request…</p>}
    {attempt && !saving && <p role="alert">The original strategy save for page {attempt.pageKey} has an unverified outcome. Its draft and attempted save are retained. {matchesKeywordAttempt(attempt,asset,actorId) ? 'Check its original receipt.' : attempt.contractVersion === 1 ? 'Open the original page and architecture version to check its receipt.' : 'This earlier save has no server request ID. Its saved versions can be inspected in Content Library.'}</p>}
    {matchesKeywordAttempt(attempt,asset,actorId) && <button type="button" disabled={saving} onClick={checkOriginal}>Check original strategy receipt</button>}
    {saved && <p role="status">Strategy version {saved.version.version_number} saved. Review this version in Content Library, then select the approved version in page targeting.</p>}
    {saved?.warnings.map((warning,index) => <p key={index} role="status">{warning}</p>)}
    {source?.strategy && !attempt && !saved && <p>This engagement already has a keyword strategy. Open its saved versions for review.</p>}
    {source && !attempt && !saved && !source.strategy && <>
      <p>Choose {asset.pageKey} as a page target for at least one keyword.</p>
      <fieldset disabled={saving}><Form type="keyword_strategy" workspace={source.workspace} studio={{saveArtifact}} versions={[]} artifact={null} latest={null} approval={null} saving={saving} act={act}
        pageDraft={{architectureId:source.version.artifact_id, versionId:asset.sourceVersionId, pageKey:asset.pageKey, restored, retain}} /></fieldset>
    </>}
    {(attempt || saved || source?.strategy) && <a href={'/sphere/content/studio?'+library} target="_blank" rel="noreferrer">Open Content Library</a>}
    <button type="button" disabled={saving || storageFailed} onClick={() => { if (!flight.current && current() && !storageFailed) onClose() }}>Return to page targeting</button>
  </section>
}
