import { useOrganization } from '../context/OrganizationContext.jsx'
import { resolveOrganizationGateState } from '../data/organizationScope.js'

const _ScopedFragment = ({ children }) => children

export default function OrganizationGate({ children }) {
  const scope = useOrganization()
  const decision = resolveOrganizationGateState(scope)
  if (decision.status === 'loading') return <_State title="Loading organization access" detail="Checking your active memberships..." />
  if (decision.status === 'error') return <_State title="Organization access unavailable" detail={scope.error.message || 'Memberships could not be loaded.'}><button type="button" onClick={scope.refreshMemberships} className="rounded-xl bg-violet-500 px-4 py-2 text-sm font-semibold text-white">Try again</button></_State>
  if (decision.status === 'empty') return <_State title="No active organization access" detail="Ask an organization administrator to restore your team membership." />
  if (decision.status === 'selection_required') return <_State title="Choose an organization" detail="Use the organization selector in the header before opening tenant data." />
  return <_ScopedFragment key={decision.scopeKey}>{children}</_ScopedFragment>
}

function _State({ title, detail, children }) {
  return <div className="flex h-full min-h-72 items-center justify-center p-6 text-white"><section className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-[#0e111a]/90 p-6 text-center shadow-2xl"><div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-violet-500/15 text-violet-300" aria-hidden="true">O</div><h1 className="mt-4 text-lg font-semibold">{title}</h1><p className="mt-2 text-sm leading-6 text-slate-400">{detail}</p>{children && <div className="mt-5">{children}</div>}</section></div>
}
