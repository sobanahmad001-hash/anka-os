import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { figmaHandoff } from '../data/figmaHandoffRepository.js'
import { requestReferenceAssets } from '../data/figmaHandoff.js'

const BUTTON = 'rounded-xl border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-amber-500 hover:text-white'

export default function FigmaHandoff() {
  const { requestId = '' } = useParams()
  const [workspace, setWorkspace] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    figmaHandoff.load(requestId)
      .then(data => { if (active) setWorkspace(data) })
      .catch(reason => { if (active) setError(reason.message) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [requestId])

  if (loading) return <div className="flex min-h-full items-center justify-center bg-slate-950 text-sm text-slate-400">Loading authenticated handoff…</div>
  if (error || !workspace) return <div className="min-h-full bg-slate-950 px-6 py-16 text-white"><div className="mx-auto max-w-3xl rounded-2xl border border-red-900/60 bg-red-950/30 p-6 text-red-200"><h1 className="text-xl font-semibold">Handoff unavailable</h1><p className="mt-2 text-sm">{error || 'This content request is unavailable.'}</p></div></div>

  const { request, brand, event, recentRequests, currentAssets, recentAssets, handoffAsset } = workspace
  const brandName = brand?.name || 'Unbranded request'
  const returnPath = request.engagement_id
    ? `/sphere/content/studio?engagement=${request.engagement_id}&tab=requests`
    : '/sphere/content/studio?tab=general'
  return <div className="min-h-full overflow-y-auto bg-slate-950 text-white">
    <header className="border-b border-slate-800 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.14),transparent_38%)] px-6 py-8">
      <div className="mx-auto max-w-6xl"><div className="flex flex-wrap items-start justify-between gap-5"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-400">Authenticated designer reference</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">{brandName} · {request.format.replaceAll('_', ' ')}</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">Keep this page open beside Figma while working manually. It contains context only—Anka OS does not create, read, or modify Figma files.</p></div><Link className={BUTTON} to={returnPath}>Back to Content requests</Link></div>{handoffAsset?.figma_handoff_url && <p className="mt-5 break-all text-xs text-slate-500">Stable internal URL: {handoffAsset.figma_handoff_url}</p>}</div>
    </header>
    <main className="mx-auto max-w-6xl space-y-6 px-6 py-6">
      <section className="grid gap-6 lg:grid-cols-2">
        <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-400">Brand context</p><h2 className="mt-2 text-2xl font-semibold">{brandName}</h2>{brand ? <>{brand.description ? <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-300">{brand.description}</p> : <p className="mt-3 text-sm text-slate-500">No brand description is recorded.</p>}{brand.website_url && <a className="mt-4 inline-block text-sm font-semibold text-amber-300 hover:text-amber-200" href={brand.website_url} target="_blank" rel="noreferrer">Open brand website ↗</a>}<div className="mt-5 rounded-xl border border-dashed border-slate-700 bg-slate-950/50 p-4 text-xs leading-5 text-slate-500">Colors, fonts, and logos are not recorded in the current brand schema. CP3 deliberately does not invent those fields.</div></> : <p className="mt-3 text-sm leading-6 text-slate-500">This general request was created without selecting a brand, so no brand context or past brand references are available.</p>}</article>
        <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-400">Production brief</p><div className="mt-3 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.1em] text-slate-500"><span>{request.format.replaceAll('_', ' ')}</span><span>·</span><span>{request.status.replaceAll('_', ' ')}</span></div><p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-slate-200">{request.brief}</p></article>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-400">Event context</p>{event ? <div className="mt-3"><h2 className="text-xl font-semibold">{event.event_name}</h2><p className="mt-2 text-sm text-slate-400">{event.event_category} · {event.start_date}{event.end_date && event.end_date !== event.start_date ? ` to ${event.end_date}` : ''}{event.location ? ` · ${event.location}` : ''}</p>{event.notes && <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-300">{event.notes}</p>}</div> : <p className="mt-3 text-sm text-slate-500">No event is linked to this request.</p>}</section>

      <AssetSection title="Outputs already generated for this request" assets={currentAssets} empty="No generated media is attached to this request." />

      <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-400">Recent brand references</p><h2 className="mt-2 text-xl font-semibold">Past content requests</h2>{recentRequests.length ? <div className="mt-5 grid gap-4 md:grid-cols-2">{recentRequests.map(item => { const assets = requestReferenceAssets(item, recentAssets); return <article key={item.id} className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60">{assets[0]?.signed_url && <img src={assets[0].signed_url} alt={`Reference output for ${item.format.replaceAll('_', ' ')}`} className="aspect-video w-full object-cover" />}<div className="p-4"><div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold uppercase tracking-[0.1em] text-amber-300">{item.format.replaceAll('_', ' ')}</p><span className="text-[10px] uppercase text-slate-600">{item.status}</span></div><p className="mt-3 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-slate-300">{item.brief}</p><p className="mt-3 text-[11px] text-slate-600">{new Date(item.created_at).toLocaleString()}</p></div></article> })}</div> : <p className="mt-4 text-sm text-slate-500">No earlier requests exist for this brand.</p>}</section>
    </main>
  </div>
}

function AssetSection({ title, assets, empty }) {
  return <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-400">Generated media</p><h2 className="mt-2 text-xl font-semibold">{title}</h2>{assets.length ? <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{assets.map(asset => <article key={asset.id} className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60">{asset.signed_url ? <img src={asset.signed_url} alt="Generated content reference" className="aspect-video w-full object-cover" /> : <div className="flex aspect-video items-center justify-center text-xs text-slate-600">Preview unavailable</div>}<div className="p-3"><div className="flex items-center justify-between gap-3"><span className="text-xs font-semibold capitalize text-white">{asset.media_type}</span><span className="text-[10px] uppercase text-slate-500">{asset.status}</span></div>{asset.failure_reason && <p className="mt-2 text-xs text-red-300">{asset.failure_reason}</p>}</div></article>)}</div> : <p className="mt-4 text-sm text-slate-500">{empty}</p>}</section>
}
