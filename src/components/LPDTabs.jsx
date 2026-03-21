import { useState, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'

/**
 * Splits a markdown string into sections by top-level (## H2) headings.
 * Returns [{ title, content }] — if no H2 found, returns a single "Overview" section.
 */
function parseMarkdownSections(markdown) {
  if (!markdown?.trim()) return []

  const lines = markdown.split('\n')
  const sections = []
  let currentTitle = null
  let currentLines = []

  for (const line of lines) {
    const h2Match = line.match(/^##\s+(.+)/)
    if (h2Match) {
      if (currentTitle !== null || currentLines.some(l => l.trim())) {
        sections.push({ title: currentTitle ?? 'Overview', content: currentLines.join('\n').trim() })
      }
      currentTitle = h2Match[1].trim()
      currentLines = []
    } else {
      currentLines.push(line)
    }
  }

  // Push the last section
  if (currentTitle !== null || currentLines.some(l => l.trim())) {
    sections.push({ title: currentTitle ?? 'Overview', content: currentLines.join('\n').trim() })
  }

  return sections.length > 0 ? sections : [{ title: 'Document', content: markdown }]
}

export default function LPDTabs({ markdown }) {
  const sections = useMemo(() => parseMarkdownSections(markdown), [markdown])
  const [activeIndex, setActiveIndex] = useState(0)

  if (!sections.length) {
    return (
      <div className="text-center py-16 text-gray-500">
        <p className="text-4xl mb-3">📄</p>
        <p className="text-sm">No document yet.</p>
      </div>
    )
  }

  // Use tabs for ≤8 sections, accordion for more
  const useAccordion = sections.length > 8

  if (useAccordion) {
    return (
      <div className="space-y-2">
        {sections.map((section, i) => (
          <AccordionSection
            key={i}
            title={section.title}
            content={section.content}
            defaultOpen={i === 0}
          />
        ))}
      </div>
    )
  }

  return (
    <div>
      {/* Tab bar */}
      <div className="flex gap-1 overflow-x-auto border-b border-gray-700 mb-6 scrollbar-none">
        {sections.map((section, i) => (
          <button
            key={i}
            onClick={() => setActiveIndex(i)}
            className={`shrink-0 px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap ${
              activeIndex === i
                ? 'border-purple-500 text-purple-400'
                : 'border-transparent text-gray-400 hover:text-gray-200'
            }`}
          >
            {section.title}
          </button>
        ))}
      </div>

      {/* Active section content */}
      <div className="prose prose-invert prose-sm max-w-none">
        <ReactMarkdown>{sections[activeIndex]?.content ?? ''}</ReactMarkdown>
      </div>
    </div>
  )
}

function AccordionSection({ title, content, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3 text-left text-sm font-medium text-gray-200 hover:bg-gray-800 transition-colors"
      >
        <span>{title}</span>
        <span className={`text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}>
          ▾
        </span>
      </button>
      {open && (
        <div className="px-5 py-4 border-t border-gray-700 prose prose-invert prose-sm max-w-none">
          <ReactMarkdown>{content}</ReactMarkdown>
        </div>
      )}
    </div>
  )
}
