import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { figmaHandoff } from '../data/figmaHandoffRepository.js'
import { requestReferenceAssets } from '../data/figmaHandoff.js'

const BUTTON = 'workspace-button'

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

  if (loading) return <div className="flex min-h-full items-center justify-center bg-[var(--anka-canvas)] text-sm text-[var(--anka-muted)]">Loading authenticated handoff…</div>
  if (error || !workspace) return <div className="min-h-full bg-[var(--anka-canvas)] px-6 py-16 text-[var(--anka-ink)]"><div className="mx-auto max-w-3xl rounded-2xl border border-[var(--anka-danger)] bg-[var(--anka-danger-soft)] p-6 text-[var(--anka-danger)]"><h1 className="workspace-title">Handoff unavailable</h1><p className="mt-2 text-sm">{error || 'This content request is unavailable.'}</p></div></div>

  const { request, brand, event, recentRequests, currentAssets, recentAssets, handoffAsset } = workspace
  const brandName = brand?.name || 'Unbranded request'
  const returnPath = request.engagement_id
    ? `/sphere/content/studio?engagement=${request.engagement_id}&tab=requests`
    : '/sphere/content/studio?tab=general'
  return <div className="min-h-full overflow-y-auto bg-[var(--anka-canvas)] text-[var(--anka-ink)]">
    <header className="border-b border-[var(--anka-line)] bg-[var(--anka-surface)] px-6 py-8">
      <div className="workspace-container"><div className="flex flex-wrap items-start justify-between gap-5"><div><p className="workspace-eyebrow">Authenticated designer reference</p><h1 className="workspace-title">{brandName} · {request.format.replaceAll('_', ' ')}</h1><p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--anka-muted)]">Keep this page open beside Figma while working manually. It contains context only—Anka OS does not create, read, or modify Figma files.</p></div><Link className={BUTTON} to={returnPath}>Back to Content requests</Link></div>{handoffAsset?.figma_handoff_url && <p className="mt-5 break-all text-xs text-[var(--anka-muted)]">Stable internal URL: {handoffAsset.figma_handoff_url}</p>}</div>
    </header>
    <main className="workspace-container workspace-page space-y-6">
      <section className="grid gap-6 lg:grid-cols-2">
        <article className="workspace-card p-6"><p className="workspace-eyebrow">Brand context</p><h2 className="mt-2 text-2xl font-semibold">{brandName}</h2>{brand ? <>{brand.description ? <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[var(--anka-ink)]">{brand.description}</p> : <p className="mt-3 text-sm text-[var(--anka-muted)]">No brand description is recorded.</p>}{brand.website_url && <a className="mt-4 inline-block text-sm font-semibold text-[var(--anka-violet)] hover:underline" href={brand.website_url} target="_blank" rel="noreferrer">Open brand website ↗</a>}<div className="mt-5 rounded-xl border border-dashed border-[var(--anka-line)] bg-[var(--anka-canvas)] p-4 text-xs leading-5 text-[var(--anka-muted)]">Colors, fonts, and logos are not recorded in the current brand schema. CP3 deliberately does not invent those fields.</div></> : <p className="mt-3 text-sm leading-6 text-[var(--anka-muted)]">This general request was created without selecting a brand, so no brand context or past brand references are available.</p>}</article>
        <article className="workspace-card p-6"><p className="workspace-eyebrow">Production brief</p><div className="mt-3 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.1em] text-[var(--anka-muted)]"><span>{request.format.replaceAll('_', ' ')}</span><span>·</span><span>{request.status.replaceAll('_', ' ')}</span></div><p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-[var(--anka-ink)]">{request.brief}</p></article>
      </section>

      <section className="workspace-card p-6"><p className="workspace-eyebrow">Event context</p>{event ? <div className="mt-3"><h2 className="text-xl font-semibold">{event.event_name}</h2><p className="mt-2 text-sm text-[var(--anka-muted)]">{event.event_category} · {event.start_date}{event.end_date && event.end_date !== event.start_date ? ` to ${event.end_date}` : ''}{event.location ? ` · ${event.location}` : ''}</p>{event.notes && <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-[var(--anka-ink)]">{event.notes}</p>}</div> : <p className="mt-3 text-sm text-[var(--anka-muted)]">No event is linked to this request.</p>}</section>

      <AssetSection title="Outputs already generated for this request" assets={currentAssets} empty="No generated media is attached to this request." />

      <section className="workspace-card p-6"><p className="workspace-eyebrow">Recent brand references</p><h2 className="mt-2 text-xl font-semibold">Past content requests</h2>{recentRequests.length ? <div className="mt-5 grid gap-4 md:grid-cols-2">{recentRequests.map(item => { const assets = requestReferenceAssets(item, recentAssets); return <article key={item.id} className="overflow-hidden rounded-xl border border-[var(--anka-line)] bg-[var(--anka-canvas)]">{assets[0]?.signed_url && <img src={assets[0].signed_url} alt={`Reference output for ${item.format.replaceAll('_', ' ')}`} className="aspect-video w-full object-cover" />}<div className="p-4"><div className="flex items-center justify-between gap-3"><p className="workspace-eyebrow">{item.format.replaceAll('_', ' ')}</p><span className="text-[10px] uppercase text-[var(--anka-muted)]">{item.status}</span></div><p className="mt-3 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-[var(--anka-ink)]">{item.brief}</p><p className="mt-3 text-[11px] text-[var(--anka-muted)]">{new Date(item.created_at).toLocaleString()}</p></div></article> })}</div> : <p className="mt-4 text-sm text-[var(--anka-muted)]">No earlier requests exist for this brand.</p>}</section>
    </main>
  </div>
}

function AssetSection({ title, assets, empty }) {
  return <section className="workspace-card p-6"><p className="workspace-eyebrow">Generated media</p><h2 className="mt-2 text-xl font-semibold">{title}</h2>{assets.length ? <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{assets.map(asset => <article key={asset.id} className="overflow-hidden rounded-xl border border-[var(--anka-line)] bg-[var(--anka-canvas)]">{asset.signed_url ? <img src={asset.signed_url} alt="Generated content reference" className="aspect-video w-full object-cover" /> : <div className="flex aspect-video items-center justify-center text-xs text-[var(--anka-muted)]">Preview unavailable</div>}<div className="p-3"><div className="flex items-center justify-between gap-3"><span className="text-xs font-semibold capitalize text-[var(--anka-ink)]">{asset.media_type}</span><span className="text-[10px] uppercase text-[var(--anka-muted)]">{asset.status}</span></div>{asset.failure_reason && <p className="mt-2 text-xs text-[var(--anka-danger)]">{asset.failure_reason}</p>}</div></article>)}</div> : <p className="mt-4 text-sm text-[var(--anka-muted)]">{empty}</p>}</section>
}
