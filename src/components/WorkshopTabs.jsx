import { useEffect, useRef } from 'react'
import { WORKSHOP_TABS } from '../data/workshopTabs.js'

export default function WorkshopTabs({ departmentId, activeTab, onChange }) {
  const tabListRef = useRef(null)
  const tabRefs = useRef(new Map())

  useEffect(() => {
    if (tabListRef.current?.contains(document.activeElement)) {
      tabRefs.current.get(activeTab)?.focus()
    }
  }, [activeTab])

  function handleKeyDown(event, currentIndex) {
    let nextIndex
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % WORKSHOP_TABS.length
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + WORKSHOP_TABS.length) % WORKSHOP_TABS.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = WORKSHOP_TABS.length - 1
    else return

    event.preventDefault()
    const nextId = WORKSHOP_TABS[nextIndex][0]
    tabRefs.current.get(nextId)?.focus()
    onChange(nextId)
  }

  return (
    <nav
      ref={tabListRef}
      aria-label="Department workspace sections"
      aria-orientation="horizontal"
      role="tablist"
      className="mt-6 flex gap-1 overflow-x-auto border-b border-slate-800"
    >
      {WORKSHOP_TABS.map(([id, label], index) => {
        const selected = activeTab === id
        return (
          <button
            key={id}
            ref={(node) => {
              if (node) tabRefs.current.set(id, node)
              else tabRefs.current.delete(id)
            }}
            id={`${departmentId}-${id}-tab`}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`${departmentId}-${id}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium ${selected ? 'border-purple-500 text-white' : 'border-transparent text-slate-500 hover:text-slate-300'}`}
          >
            {label}
          </button>
        )
      })}
    </nav>
  )
}
