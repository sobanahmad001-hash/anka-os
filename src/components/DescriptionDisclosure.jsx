import { useId, useLayoutEffect, useRef, useState } from 'react'

// The key resets disclosure state when a different record/content replaces this view.
export default function DescriptionDisclosure({ text, label = 'Description' }) {
  return <DescriptionContent key={text} text={text} label={label} />
}

// eslint-disable-next-line no-unused-vars -- JSX component usage is not counted by this lint configuration.
function DescriptionContent({ text, label }) {
  const id = useId()
  const preview = useRef(null)
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  useLayoutEffect(() => {
    if (expanded) return
    const element = preview.current
    if (!element) return
    const measure = () => setOverflowing(element.scrollHeight > element.clientHeight + 1)
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(element)
    window.addEventListener('resize', measure)
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [expanded])
  return <section aria-label={label} className="mt-3 min-w-0 text-sm leading-6 text-[var(--anka-muted)]">
    <p ref={preview} hidden={expanded} style={{display:expanded?'none':'-webkit-box',WebkitBoxOrient:'vertical',WebkitLineClamp:4,overflow:'hidden',whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{text}</p>
    {overflowing && <button type="button" aria-expanded={expanded} aria-controls={id} aria-label={(expanded?'Show less: ':'Read more: ')+label} onClick={()=>setExpanded(value=>!value)} className="workspace-button mt-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--anka-focus)]">{expanded?'Show less':'Read more'}</button>}
    <div id={id} hidden={!expanded} className="mt-3 rounded-xl border border-[var(--anka-line)] bg-[var(--anka-surface)] p-4">
      {expanded && <p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{text}</p>}
    </div>
  </section>
}
