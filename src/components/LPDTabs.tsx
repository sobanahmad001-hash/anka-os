// LPDTabs.tsx
import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';

const SECTIONS = [
  { key: 'executive-summary', label: 'Executive Summary', heading: '## Executive Summary' },
  { key: 'architecture', label: 'Architecture Overview', heading: '## Architecture Overview' },
  { key: 'current-state', label: 'Current State', heading: '## Current State' },
  { key: 'core-features', label: 'Core Features & Modules', heading: '## Core Features & Modules' },
  { key: 'known-gaps', label: 'Known Gaps & Limitations', heading: '## Known Gaps & Limitations' },
  { key: 'benchmarking', label: 'Benchmarking & Inspiration', heading: '## Benchmarking & Inspiration' },
  { key: 'roadmap', label: 'Roadmap / Next Steps', heading: '## Roadmap / Next Steps' },
  { key: 'open-questions', label: 'Open Questions', heading: '## Open Questions' },
  { key: 'changelog', label: 'Changelog', heading: '## Changelog' },
];

function splitMarkdownSections(markdown: string) {
  // Returns an object: { sectionKey: markdownContent }
  const result: Record<string, string> = {};
  let currentKey = 'executive-summary';
  let buffer = '';
  const lines = markdown.split('\n');
  for (let line of lines) {
    const match = SECTIONS.find(sec => line.trim().toLowerCase() === sec.heading.toLowerCase());
    if (match) {
      if (buffer && currentKey) {
        result[currentKey] = buffer.trim();
      }
      currentKey = match.key;
      buffer = line + '\n';
    } else {
      buffer += line + '\n';
    }
  }
  if (buffer && currentKey) {
    result[currentKey] = buffer.trim();
  }
  return result;
}

export default function LPDTabs({ markdown }: { markdown: string }) {
  const [activeTab, setActiveTab] = useState(SECTIONS[0].key);
  const sections = splitMarkdownSections(markdown);

  return (
    <div>
      <div className="flex border-b border-gray-200 mb-4 overflow-x-auto">
        {SECTIONS.map(sec => (
          <button
            key={sec.key}
            onClick={() => setActiveTab(sec.key)}
            className={`px-4 py-2 -mb-px border-b-2 transition font-medium whitespace-nowrap ${
              activeTab === sec.key ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-blue-500'
            }`}
          >
            {sec.label}
          </button>
        ))}
      </div>
      <div className="p-4 bg-white rounded shadow">
        <ReactMarkdown>{sections[activeTab] || '_No content for this section._'}</ReactMarkdown>
      </div>
    </div>
  );
}
