import {useMemo, useState} from 'react'
import {Link} from 'react-router-dom'
import {projectDeliveryContext} from '../data/projectDeliveryContext.js'
import WorkspaceDialog from './WorkspaceDialog.jsx'

// Read-only presentation of the current authorized snapshot. Never infer an asset
// or stage from a conversation title, and never turn navigation into a command.
export default function StudioProjectContext({workspace, busy, stale, onOpen, canNavigate = () => true}) {
  const data = useMemo(() => projectDeliveryContext(workspace), [workspace])
  const [collapsed, setCollapsed] = useState(false)
  const [drawer, setDrawer] = useState(false)
  const [selected, setSelected] = useState('')
  const work = data.records.find(row => `${row.kind}:${row.id}` === selected)
  const blocked = busy || stale
  const content = <>
    {stale && <p role="status">Last recorded context. Refresh the project before continuing.</p>}
    <label className="studio-context-label">Linked work
      <select className="workspace-input" value={work ? selected : ''} onChange={event => setSelected(event.target.value)}>
        <option value="">Choose project work</option>
        {data.records.map(row => <option key={`${row.kind}:${row.id}`} value={`${row.kind}:${row.id}`}>{row.title}</option>)}
      </select>
    </label>
    {work ? <section><h3>{work.title}</h3><p>{work.status.replaceAll('_', ' ')} · {work.owner?.name || 'Unassigned'}</p>
      <h3>Linked output</h3><p>{work.artifact?.title || 'No accessible output is linked to this work.'}</p>
      <h3>Next action</h3><p>{work.next?.reason || 'Open the original work to continue.'}</p>
      <Link className="workspace-button" aria-disabled={blocked} to={work.next?.path || work.recordPath} onClick={event => {if (blocked || !canNavigate()) event.preventDefault()}}>{work.next?.label || 'Open original work'}</Link>
    </section> : <p>Choose a record to see its linked output and next action. This does not associate the conversation with that work.</p>}
    <section><h3>Recorded delivery stages</h3>{data.stages.length ? <ol className="studio-stage-list">{data.stages.map(stage => <li key={stage.id}><span>{stage.name}</span><small>{stage.status.replaceAll('_', ' ')}</small></li>)}</ol> : <p>No delivery stages are recorded in this snapshot.</p>}</section>
    <button type="button" className="workspace-button" disabled={blocked} onClick={() => {setDrawer(false); onOpen('work')}}>Open project work</button>
    <p className="studio-context-note">Work status, output approval and publication are separate.</p>
  </>
  return <>
    <button type="button" className="workspace-button studio-context-mobile" aria-haspopup="dialog" onClick={() => setDrawer(true)}>Project details</button>
    <aside className={`studio-context ${collapsed ? 'studio-context-collapsed' : ''}`} aria-label="Project context">
      <button type="button" className="workspace-button" aria-expanded={!collapsed} aria-controls="studio-context-content" onClick={() => setCollapsed(value => !value)}>{collapsed ? 'Show details' : 'Hide details'}</button>
      <div id="studio-context-content" hidden={collapsed}>{content}</div>
    </aside>
    {drawer && <WorkspaceDialog title="Project details" onClose={() => setDrawer(false)}>{content}</WorkspaceDialog>}
  </>
}
