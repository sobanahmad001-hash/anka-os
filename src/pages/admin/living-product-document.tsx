import React, { useState } from 'react';
import { useLivingProductDocument } from '../../hooks/useLivingProductDocument';
import ReactMarkdown from 'react-markdown';
import dynamic from 'next/dynamic';
import 'react-mde/lib/styles/css/react-mde-all.css';

const ReactMde = dynamic(() => import('react-mde'), { ssr: false });

const SECTION_TITLES = [
  'Executive Summary',
  'Architecture Overview',
  'Current State',
  'Core Features & Modules',
  'Known Gaps',
  'Benchmarking & Inspiration',
  'Roadmap',
  'Open Questions',
  'Changelog',
];

function splitSections(content: string) {
  // Simple markdown section splitter by level 2 headings (##)
  const sections: { title: string; body: string }[] = [];
  const regex = /^## (.+)$/gm;
  let lastIndex = 0;
  let match;
  let lastTitle = 'Executive Summary';
  while ((match = regex.exec(content))) {
    if (sections.length > 0) {
      sections[sections.length - 1].body = content.slice(lastIndex, match.index).trim();
    }
    lastTitle = match[1];
    sections.push({ title: lastTitle, body: '' });
    lastIndex = regex.lastIndex;
  }
  if (sections.length > 0) {
    sections[sections.length - 1].body = content.slice(lastIndex).trim();
  } else {
    sections.push({ title: 'Executive Summary', body: content });
  }
  return sections;
}

export default function LivingProductDocumentPage() {
  const { document, loading, error, isAdmin, updateDocument, refetch } = useLivingProductDocument();
  const [editing, setEditing] = useState(false);
  const [markdown, setMarkdown] = useState('');
  const [selectedTab, setSelectedTab] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [summary, setSummary] = useState('');
  const [changelogSummary, setChangelogSummary] = useState('');

  React.useEffect(() => {
    if (document && !editing) {
      setMarkdown(document.content);
    }
  }, [document, editing]);

  if (loading) return <div className="p-8">Loading...</div>;
  if (error) return <div className="p-8 text-red-500">Error: {error}</div>;
  if (!document) return <div className="p-8">No Living Product Document found.</div>;

  const sections = splitSections(document.content);

  const handleSave = async () => {
    setIsSaving(true);
    const entry = {
      date: new Date().toISOString().slice(0, 10),
      author: 'You', // Optionally resolve user name
      summary: changelogSummary || 'Edited LPD',
    };
    const ok = await updateDocument(markdown, entry);
    setIsSaving(false);
    if (ok) {
      setEditing(false);
      setChangelogSummary('');
      refetch();
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-3xl font-bold mb-6">Anka OS — Living Product Document</h1>
      <div className="mb-4 flex flex-wrap gap-2">
        {sections.map((section, idx) => (
          <button
            key={section.title}
            className={`px-4 py-2 rounded-t ${selectedTab === idx ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}
            onClick={() => setSelectedTab(idx)}
          >
            {section.title}
          </button>
        ))}
        <button
          className={`px-4 py-2 rounded-t ${selectedTab === sections.length ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`}
          onClick={() => setSelectedTab(sections.length)}
        >
          Changelog
        </button>
      </div>
      <div className="border rounded-b bg-white p-6 min-h-[300px]">
        {selectedTab === sections.length ? (
          <div>
            <h2 className="text-xl font-semibold mb-2">Changelog</h2>
            <ul className="space-y-2">
              {document.changelog && document.changelog.length > 0 ? (
                document.changelog.map((entry, i) => (
                  <li key={i} className="border-b pb-2">
                    <span className="font-mono text-gray-500">{entry.date}</span> — <span className="font-semibold">{entry.author}</span>: {entry.summary}
                  </li>
                ))
              ) : (
                <li>No changelog entries yet.</li>
              )}
            </ul>
          </div>
        ) : editing ? (
          <div>
            <ReactMde
              value={markdown}
              onChange={setMarkdown}
              selectedTab={"write"}
              onTabChange={() => {}}
              generateMarkdownPreview={markdown => Promise.resolve(<ReactMarkdown>{markdown}</ReactMarkdown>)}
              minEditorHeight={300}
            />
            <div className="mt-4">
              <input
                type="text"
                className="border px-2 py-1 rounded w-full mb-2"
                placeholder="Changelog summary (required)"
                value={changelogSummary}
                onChange={e => setChangelogSummary(e.target.value)}
                required
              />
              <button
                className="bg-blue-600 text-white px-4 py-2 rounded mr-2"
                onClick={handleSave}
                disabled={isSaving || !changelogSummary}
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
              <button
                className="bg-gray-200 px-4 py-2 rounded"
                onClick={() => setEditing(false)}
                disabled={isSaving}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div>
            <ReactMarkdown>{sections[selectedTab]?.body || ''}</ReactMarkdown>
          </div>
        )}
      </div>
      {isAdmin && !editing && (
        <div className="mt-4 text-right">
          <button
            className="bg-blue-600 text-white px-4 py-2 rounded"
            onClick={() => setEditing(true)}
          >
            Edit Document
          </button>
        </div>
      )}
    </div>
  );
}
