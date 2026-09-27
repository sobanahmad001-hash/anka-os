import DesignVideoCapabilities from './DesignVideoCapabilities.jsx'
import { useCallback, useEffect, useState } from 'react'
import { useBlocker } from 'react-router-dom'
import { useOrganization } from '../context/OrganizationContext.jsx'

// Uses the saved owner-private conversation only; no project or chat history is supplied.
export default function PrivateDesignVideoTools({ conversationId, beforeGenerate, onNavigationBusyChange }) {
  const { activeOrganizationId } = useOrganization()
  const [busy, setBusy] = useState(false)
  const blocker = useBlocker(busy)
  const reportBusy = useCallback(value => { setBusy(value); onNavigationBusyChange?.(value) }, [onNavigationBusyChange])
  useEffect(() => {
    if (!busy) return undefined
    const unload = event => { event.preventDefault(); event.returnValue = '' }
    const organization = event => { if (event.detail?.organizationId !== activeOrganizationId) event.preventDefault() }
    window.addEventListener('beforeunload', unload)
    window.addEventListener('anka:organization-change', organization)
    return () => { window.removeEventListener('beforeunload', unload); window.removeEventListener('anka:organization-change', organization) }
  }, [busy, activeOrganizationId])
  useEffect(() => {
    // Cancel the attempted route change; never silently replay it after recovery.
    if (blocker.state === 'blocked' && !busy) blocker.reset()
  }, [blocker.state, blocker.reset, busy])
  if (!conversationId) return <p role="status">Save a private conversation before opening Video.</p>
  return <section className="design-tools-workbench" aria-label="Private Design video tools">
    <h3>Video · Higgsfield Seedance 2.5</h3>
    {blocker.state === 'blocked' && <p role="alert">A private video request or draft copy needs recovery before leaving. <button type="button" onClick={() => blocker.reset()}>Stay and recover</button></p>}
    <DesignVideoCapabilities privateConversationId={conversationId} presentation="workbench"
      beforeGenerate={beforeGenerate} onNavigationBusyChange={reportBusy} />
  </section>
}
