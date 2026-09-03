const _ScopedFragment = ({ children }) => children
import { useOrganization } from '../context/OrganizationContext.jsx'

export default function OrganizationGate({ children }) {
  const { memberships, activeOrganizationId, selectionRequired, loading, error, refreshMemberships, scopeRevision } = useOrganization()
  if (loading) return <_State title="Loading organization access" detail="Checking your active memberships..." />
  if (error) return <_State title="Organization access unavailable" detail={error.message || 'Memberships could not be loaded.'}><button type="button" onClick={refreshMemberships} className="rounded-xl bg-violet-500 px-4 py-2 text-sm font-semibold text-white">Try again</button></_State>
  if (!memberships.length) return <_State title="No active organization access" detail="Ask an organization administrator to restore your team membership." />
  if (selectionRequired || !activeOrganizationId) return <_State title="Choose an organization" detail="Use the organization selector in the header before opening tenant data." />
  return <_ScopedFragment key={activeOrganizationId + ':' + scopeRevision}>{children}</_ScopedFragment>
}

function _State({ title, detail, children }) {
  return <div className="flex h-full min-h-72 items-center justify-center p-6 text-white"><section className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-[#0e111a]/90 p-6 text-center shadow-2xl"><div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-violet-500/15 text-violet-300" aria-hidden="true">O</div><h1 className="mt-4 text-lg font-semibold">{title}</h1><p className="mt-2 text-sm leading-6 text-slate-400">{detail}</p>{children && <div className="mt-5">{children}</div>}</section></div>
}
