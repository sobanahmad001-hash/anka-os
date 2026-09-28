import { Link } from 'react-router-dom'
import OrganizationGate from '../components/OrganizationGate.jsx'

export default function PlanningWorkspace() {
  return <OrganizationGate><main className="workspace-page"><div className="workspace-container max-w-5xl">
    <header>
      <p className="workspace-eyebrow">Plan and schedule</p>
      <h1 className="workspace-title">Planning</h1>
      <p className="workspace-description">Plan brand events, calendar work and recurring project delivery.</p>
    </header>
    <section aria-label="Planning areas" className="mt-7 grid gap-4 md:grid-cols-2">
      <Link to="/sphere/events" className="workspace-card group p-6 outline-none transition hover:border-[var(--anka-violet)] focus-visible:ring-2 focus-visible:ring-[var(--anka-focus)]">
        <h2 className="text-base font-semibold text-[var(--anka-ink)]">Brand Events &amp; Calendar</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--anka-muted)]">Existing brand events, monthly calendar and linked content work.</p>
        <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[var(--anka-violet)]">Open calendar <span aria-hidden="true">→</span></span>
      </Link>
      <Link to="/sphere/portfolio" className="workspace-card group p-6 outline-none transition hover:border-[var(--anka-violet)] focus-visible:ring-2 focus-visible:ring-[var(--anka-focus)]">
        <h2 className="text-base font-semibold text-[var(--anka-ink)]">Project &amp; Recurring Planning</h2>
        <p className="mt-2 text-sm leading-6 text-[var(--anka-muted)]">Open a project’s Work section for scheduling. Retainer projects also include recurring delivery planning.</p>
        <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-[var(--anka-violet)]">Browse projects <span aria-hidden="true">→</span></span>
      </Link>
    </section>
  </div></main></OrganizationGate>
}
