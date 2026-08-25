import { useLocation, useNavigate } from 'react-router-dom'

export default function AssistantFloat() {
  const location = useLocation()
  const navigate = useNavigate()
  if (location.pathname === '/assistant') return null

  return <button onClick={() => navigate('/assistant')} className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-full border border-purple-500/40 bg-purple-600 px-4 py-3 text-white shadow-2xl transition hover:bg-purple-700" title="Open permission-scoped Anka AI"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/15 text-xs font-bold">A</span><span className="hidden text-sm font-medium sm:block">Ask Anka</span></button>
}
