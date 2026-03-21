import React, { useState } from "react";
import { useLivingProductDocument, ChangelogEntry } from "../../hooks/useLivingProductDocument";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github.css";
import { useUser } from "../../hooks/useUser";
import { Tabs } from "../../components/ui/Tabs";
import { Button } from "../../components/ui/Button";
import { Modal } from "../../components/ui/Modal";
import dynamic from "next/dynamic";

const ReactMde = dynamic(() => import("react-mde"), { ssr: false });
import "react-mde/lib/styles/css/react-mde-all.css";

const SECTION_TITLES = [
  "Executive Summary",
  "Architecture Overview",
  "Current State",
  "Core Features & Modules",
  "Known Gaps",
  "Benchmarking & Inspiration",
  "Roadmap",
  "Open Questions",
  "Changelog",
];

function splitSections(content: string) {
  // Splits markdown into sections based on level 2 headings (##)
  const sections: Record<string, string> = {};
  let current = "Executive Summary";
  let buffer = "";
  const lines = content.split("\n");
  for (let line of lines) {
    const match = line.match(/^## (.+)$/);
    if (match) {
      sections[current] = buffer.trim();
      current = match[1];
      buffer = "";
    } else {
      buffer += line + "\n";
    }
  }
  sections[current] = buffer.trim();
  return sections;
}

export default function LivingProductDocumentPage() {
  const { doc, loading, error, updateDoc, user, profile } = useLivingProductDocument();
  const [editMode, setEditMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [selectedTab, setSelectedTab] = useState(SECTION_TITLES[0]);

  const isAdmin = profile?.role === "admin" || profile?.is_admin;

  if (loading) return <div className="p-8">Loading...</div>;
  if (error) return <div className="p-8 text-red-500">Error: {error}</div>;
  if (!doc) return <div className="p-8">No Living Product Document found.</div>;

  const sections = splitSections(doc.content);

  function handleEditClick() {
    setEditContent(doc.content);
    setEditMode(true);
    setEditSummary("");
  }

  async function handleSave() {
    if (!editSummary.trim()) {
      alert("Please provide a changelog summary.");
      return;
    }
    const changelogEntry: ChangelogEntry = {
      date: new Date().toISOString().slice(0, 10),
      author: profile?.full_name || user?.email || "Unknown",
      summary: editSummary,
    };
    await updateDoc(editContent, changelogEntry);
    setEditMode(false);
  }

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <h1 className="text-3xl font-bold mb-2">Anka OS — Living Product Document</h1>
      <div className="mb-4 flex items-center justify-between">
        <span className="text-gray-500">Internal: Core Dev Team Only</span>
        {isAdmin && (
          <Button onClick={handleEditClick} size="sm">Edit</Button>
        )}
      </div>
      <Tabs
        tabs={SECTION_TITLES}
        selected={selectedTab}
        onSelect={setSelectedTab}
      />
      <div className="mt-6 bg-white rounded shadow p-6 min-h-[300px]">
        {selectedTab !== "Changelog" ? (
          <ReactMarkdown
            children={sections[selectedTab] || "_(No content in this section)_"}
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            linkTarget="_blank"
            className="prose max-w-none"
          />
        ) : (
          <div>
            <h2 className="text-xl font-semibold mb-2">Revision History</h2>
            <ul className="divide-y divide-gray-200">
              {(doc.changelog || []).map((entry, i) => (
                <li key={i} className="py-2 text-sm">
                  <span className="font-semibold">{entry.date}</span> — {entry.author}: {entry.summary}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <Modal open={editMode} onClose={() => setEditMode(false)} title="Edit Living Product Document">
        <div className="mb-4">
          <label className="block font-semibold mb-1">Markdown Content</label>
          <ReactMde
            value={editContent}
            onChange={setEditContent}
            generateMarkdownPreview={markdown =>
              Promise.resolve(
                <ReactMarkdown
                  children={markdown}
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                  className="prose max-w-none"
                />
              )
            }
            minEditorHeight={300}
          />
        </div>
        <div className="mb-4">
          <label className="block font-semibold mb-1">Changelog Summary <span className="text-red-500">*</span></label>
          <input
            type="text"
            className="w-full border rounded px-2 py-1"
            value={editSummary}
            onChange={e => setEditSummary(e.target.value)}
            placeholder="Describe your changes..."
          />
        </div>
        <div className="flex gap-2 justify-end">
          <Button onClick={() => setEditMode(false)} variant="secondary">Cancel</Button>
          <Button onClick={handleSave} variant="primary">Save</Button>
        </div>
      </Modal>
    </div>
  );
}
