import { Link as _Link } from 'react-router-dom'

const label = value => value?.replaceAll('_', ' ') || 'Not recorded'
const when = value => value ? new Date(value).toLocaleString() : 'Not recorded'

export default function ProjectReviewEvidencePanel({ deliverables }) {
  const versions = deliverables.flatMap(deliverable => deliverable.versions.map(version => ({
    ...version, deliverableTitle: deliverable.title,
  })))
  return <section aria-label="Exact-version review and release evidence" className="rounded-2xl border border-white/[0.07] bg-white/[0.025] p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold">Exact-version review and release</h2><p className="mt-1 text-xs leading-5 text-slate-500">Specialist decisions, project-manager confirmation, and client release are separate recorded facts. This view does not approve or release anything.</p></div><_Link to="/sphere/my-work?tab=review" className="rounded-lg border border-violet-500/25 px-3 py-2 text-xs font-semibold text-violet-200">Open review queue</_Link></div>
    <div className="mt-4 space-y-3">{versions.length ? versions.map(version => {
      const quality = version.approvals?.find(item => item.approval_type === 'internal_quality')
      const pm = version.pmConfirmations?.[0]
      const release = version.lifecycleEvents?.find(item => item.event_type === 'released')
      const client = version.approvals?.find(item => item.approval_type === 'client_approval')
      return <article key={version.id} id={`deliverable-version-${version.id}`} className="rounded-xl border border-white/10 p-4 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-medium">{version.deliverableTitle} · v{version.version_number}</p><p className="mt-1 break-all text-[11px] text-slate-500">Exact version: {version.id}</p></div><span className="rounded-full border border-white/10 px-2 py-1 text-[11px] text-slate-300">{label(version.review_status)}</span></div>
        {version.change_summary && <p className="mt-3 text-slate-400">{version.change_summary}</p>}
        <dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg bg-white/[0.025] p-2"><dt className="text-slate-500">Specialist review</dt><dd className="mt-1 text-slate-300">{quality ? `${label(quality.decision)} · ${when(quality.decided_at)}` : 'No decision recorded'}</dd></div>
          <div className="rounded-lg bg-white/[0.025] p-2"><dt className="text-slate-500">Project-manager confirmation</dt><dd className="mt-1 text-slate-300">{pm ? `Recorded · ${when(pm.confirmed_at)}` : 'No confirmation recorded'}</dd></div>
          <div className="rounded-lg bg-white/[0.025] p-2"><dt className="text-slate-500">Client release</dt><dd className="mt-1 text-slate-300">{release ? `Released · ${when(release.occurred_at)}` : 'No release event recorded'}</dd></div>
          <div className="rounded-lg bg-white/[0.025] p-2"><dt className="text-slate-500">Client decision</dt><dd className="mt-1 text-slate-300">{client ? `${label(client.decision)} · ${when(client.decided_at)}` : 'No decision recorded'}</dd></div>
        </dl>
      </article>
    }) : <p className="text-sm text-slate-500">No deliverable versions recorded.</p>}</div>
  </section>
}
