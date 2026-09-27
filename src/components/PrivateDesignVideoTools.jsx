import DesignVideoCapabilities from './DesignVideoCapabilities.jsx'

// Uses the saved owner-private conversation only; no project or chat history is supplied.
export default function PrivateDesignVideoTools({ conversationId, beforeGenerate, onNavigationBusyChange }) {
  if (!conversationId) return <p role="status">Save a private conversation before opening Video.</p>
  return <section className="design-tools-workbench" aria-label="Private Design video tools">
    <h3>Video · Higgsfield Seedance 2.5</h3>
    <DesignVideoCapabilities privateConversationId={conversationId} presentation="workbench"
      beforeGenerate={beforeGenerate} onNavigationBusyChange={onNavigationBusyChange} />
  </section>
}
