import { Link } from 'react-router-dom'
import OrganizationGate from '../components/OrganizationGate.jsx'

export default function PlanningWorkspace() {
  return <OrganizationGate><main className="min-h-full bg-slate-950 p-4 text-white sm:p-8"><div className="mx-auto max-w-5xl">
    <h1 className="text-3xl font-semibold">Planning</h1>
    <p className="mt-3 text-sm text-slate-400">Plan brand events, calendar work and recurring project delivery.</p>
    <div className="mt-7 grid gap-4 md:grid-cols-2">
      <Link to="/sphere/events" className="rounded-2xl border border-white/10 bg-white/[0.025] p-6 hover:border-violet-400/40"><h2 className="font-semibold">Brand Events & Calendar</h2><p className="mt-2 text-sm text-slate-400">Existing brand events, monthly calendar and linked content work.</p></Link>
      <Link to="/sphere/portfolio" className="rounded-2xl border border-white/10 bg-white/[0.025] p-6 hover:border-violet-400/40"><h2 className="font-semibold">Project & Recurring Planning</h2><p className="mt-2 text-sm text-slate-400">Open a project’s Work section for scheduling. Retainer projects also include recurring delivery planning.</p></Link>
    </div>
  </div></main></OrganizationGate>
}
