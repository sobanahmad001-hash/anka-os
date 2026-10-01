import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import './workshopConversationRail.css'

export default function WorkshopConversationRail({ header, navigationBusy, renderHistory, children }) {
  const [mobile, setMobile] = useState(() => globalThis.matchMedia?.('(max-width: 900px)').matches ?? false)
  const [open, setOpen] = useState(() => !(globalThis.matchMedia?.('(max-width: 900px)').matches ?? false))
  const rail = useRef(null), opener = useRef(null), close = useRef(null)
  useEffect(() => {
    const media = globalThis.matchMedia?.('(max-width: 900px)')
    if (!media) return
    const changed = () => { setMobile(media.matches); setOpen(!media.matches) }
    media.addEventListener('change', changed)
    return () => media.removeEventListener('change', changed)
  }, [])
  useLayoutEffect(() => {
    if (!open || mobile || !rail.current?.getBoundingClientRect || !rail.current.style?.setProperty) return
    const node = rail.current
    const measure = () => node.style.setProperty('--workshop-history-height', Math.max(160,(globalThis.innerHeight || 900)-node.getBoundingClientRect().top-16)+'px')
    measure();globalThis.addEventListener?.('resize',measure);globalThis.addEventListener?.('scroll',measure,true)
    return () => {globalThis.removeEventListener?.('resize',measure);globalThis.removeEventListener?.('scroll',measure,true)}
  }, [open,mobile])
  useEffect(() => {
    if (!open || !mobile || !rail.current) return
    const origin=opener.current
    const changed=[],overflow=document.body.style.overflow
    document.body.style.overflow='hidden'
    let branch=rail.current
    while(branch?.parentElement && branch!==document.body){
      for(const node of branch.parentElement.children)if(node!==branch){changed.push([node,node.inert]);node.inert=true}
      branch=branch.parentElement
    }
    close.current?.focus()
    return () => {document.body.style.overflow=overflow;for(const [node,value] of changed)node.inert=value;origin?.focus()}
  }, [open,mobile])
  const keys = event => {
    if (!mobile) return
    if(event.key==='Escape'){event.preventDefault();setOpen(false);return}
    if(event.key!=='Tab')return
    const nodes=[...rail.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]')].filter(node=>node.getClientRects().length)
    if(!nodes.length){event.preventDefault();return}
    if(event.shiftKey&&document.activeElement===nodes[0]){event.preventDefault();nodes.at(-1).focus()}
    else if(!event.shiftKey&&document.activeElement===nodes.at(-1)){event.preventDefault();nodes[0].focus()}
  }
  return <div className="workshop-conversation-shell">
    <div className="workshop-conversation-topbar">{header}<button ref={opener} type="button" className="workshop-history-toggle" aria-expanded={open} onClick={()=>setOpen(!open)}>History</button></div>
    <div className={'workshop-conversation-layout'+(open&&!mobile?' history-open':'')}>
      {open&&<aside ref={rail} className={'workshop-conversation-rail'+(mobile?' mobile-history':'')} role={mobile?'dialog':undefined} aria-modal={mobile?true:undefined} aria-label="Workshop history" onKeyDown={keys}>
        {mobile&&<div className="workshop-history-heading"><strong>History</strong><button ref={close} type="button" onClick={()=>setOpen(false)}>Back to chat</button></div>}
        {renderHistory(item=>{if(navigationBusy)return;setOpen(!mobile);item()})}
      </aside>}
      <div className="min-w-0">{children}</div>
    </div>
  </div>
}
