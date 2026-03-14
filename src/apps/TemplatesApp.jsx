import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

const TEMPLATE_TYPES = [
  { value: 'task', label: 'Task', icon: '✅' },
  { value: 'project', label: 'Project', icon: '📋' },
  { value: 'campaign', label: 'Campaign', icon: '📊' },
  { value: 'invoice', label: 'Invoice', icon: '🧾' },
];

const TYPE_ICONS = { task: '✅', project: '📋', campaign: '📊', invoice: '🧾' };

export default function TemplatesApp() {
  const { user } = useAuth();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('list'); // list | create | detail
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [filter, setFilter] = useState('all');

  // Form state
  const [form, setForm] = useState({
    name: '',
    description: '',
    template_type: 'task',
    is_shared: false,
    icon: '📋',
    template_data: {},
  });

  // Task template fields
  const [taskFields, setTaskFields] = useState({ title: '', priority: 'medium', status: 'todo', description: '' });
  // Project template fields
  const [projectFields, setProjectFields] = useState({ name: '', priority: 'medium', status: 'planning', description: '' });

  useEffect(() => { loadTemplates(); }, []);

  async function loadTemplates() {
    setLoading(true);
    const { data } = await supabase
      .from('templates')
      .select('*')
      .order('usage_count', { ascending: false });
    if (data) setTemplates(data);
    setLoading(false);
  }

  async function createTemplate() {
    if (!form.name.trim()) return;

    let templateData = {};
    if (form.template_type === 'task') templateData = { ...taskFields };
    else if (form.template_type === 'project') templateData = { ...projectFields };

    await supabase.from('templates').insert([{
      created_by: user.id,
      name: form.name.trim(),
      description: form.description.trim(),
      template_type: form.template_type,
      is_shared: form.is_shared,
      icon: form.icon,
      template_data: templateData,
    }]);

    setForm({ name: '', description: '', template_type: 'task', is_shared: false, icon: '📋', template_data: {} });
    setTaskFields({ title: '', priority: 'medium', status: 'todo', description: '' });
    setProjectFields({ name: '', priority: 'medium', status: 'planning', description: '' });
    setView('list');
    loadTemplates();
  }

  async function useTemplate(template) {
    // Increment usage count
    await supabase
      .from('templates')
      .update({ usage_count: (template.usage_count || 0) + 1 })
      .eq('id', template.id);

    const data = template.template_data || {};

    if (template.template_type === 'task') {
      await supabase.from('tasks').insert([{
        user_id: user.id,
        title: data.title || template.name,
        description: data.description || '',
        priority: data.priority || 'medium',
        status: data.status || 'todo',
      }]);
    } else if (template.template_type === 'project') {
      await supabase.from('projects').insert([{
        created_by: user.id,
        name: data.name || template.name,
        description: data.description || '',
        priority: data.priority || 'medium',
        status: data.status || 'planning',
      }]);
    }

    loadTemplates();
    setSelectedTemplate(null);
    setView('list');
  }

  async function deleteTemplate(id) {
    await supabase.from('templates').delete().eq('id', id);
    loadTemplates();
    if (selectedTemplate?.id === id) { setSelectedTemplate(null); setView('list'); }
  }

  const filtered = filter === 'all' ? templates : templates.filter((t) => t.template_type === filter);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-[var(--anka-text-secondary)]">
        Loading templates...
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-5 py-3 border-b border-[var(--anka-border)] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold">Templates</h2>
          {view !== 'list' && (
            <button
              onClick={() => { setView('list'); setSelectedTemplate(null); }}
              className="text-xs text-[var(--anka-accent)] hover:text-[var(--anka-accent-hover)] cursor-pointer"
            >
              ← Back
            </button>
          )}
        </div>
        {view === 'list' && (
          <button
            onClick={() => setView('create')}
            className="px-3 py-1.5 bg-[var(--anka-accent)] hover:bg-[var(--anka-accent-hover)] text-white text-xs rounded-lg transition cursor-pointer"
          >
            + New Template
          </button>
        )}
      </div>

      {view === 'list' && (
        <div className="flex-1 overflow-y-auto">
          {/* Filters */}
          <div className="px-5 py-3 flex gap-2 border-b border-[var(--anka-border)]">
            <FilterBtn label="All" value="all" active={filter} onClick={setFilter} />
            {TEMPLATE_TYPES.map((t) => (
              <FilterBtn key={t.value} label={t.label} value={t.value} active={filter} onClick={setFilter} />
            ))}
          </div>

          {filtered.length === 0 ? (
            <div className="p-10 text-center">
              <div className="text-3xl mb-2">📋</div>
              <div className="text-sm text-[var(--anka-text-secondary)]">No templates yet</div>
              <div className="text-xs text-[var(--anka-text-secondary)] mt-1">Create reusable templates for tasks, projects, and more</div>
            </div>
          ) : (
            <div className="p-4 grid grid-cols-2 gap-3">
              {filtered.map((t) => (
                <div
                  key={t.id}
                  className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-4 hover:border-[var(--anka-accent)]/30 transition cursor-pointer"
                  onClick={() => { setSelectedTemplate(t); setView('detail'); }}
                >
                  <div className="flex items-start justify-between mb-2">
                    <span className="text-2xl">{t.icon || TYPE_ICONS[t.template_type]}</span>
                    {t.is_shared && (
                      <span className="text-[9px] px-1.5 py-0.5 bg-[var(--anka-accent)]/15 text-[var(--anka-accent)] rounded-full">shared</span>
                    )}
                  </div>
                  <div className="text-sm font-medium truncate">{t.name}</div>
                  <div className="text-[10px] text-[var(--anka-text-secondary)] mt-1 truncate">{t.description || 'No description'}</div>
                  <div className="flex items-center justify-between mt-3">
                    <span className="text-[10px] px-2 py-0.5 bg-[var(--anka-bg-tertiary)] rounded-full text-[var(--anka-text-secondary)] capitalize">
                      {t.template_type}
                    </span>
                    <span className="text-[10px] text-[var(--anka-text-secondary)]">Used {t.usage_count}×</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {view === 'create' && (
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <h3 className="text-sm font-semibold">Create Template</h3>

          <div className="space-y-3">
            <Input label="Template Name" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="e.g., Bug Report Task" />
            <Input label="Description" value={form.description} onChange={(v) => setForm((f) => ({ ...f, description: v }))} placeholder="What is this template for?" />

            <div>
              <label className="text-xs text-[var(--anka-text-secondary)] uppercase font-semibold block mb-1">Type</label>
              <div className="flex gap-2">
                {TEMPLATE_TYPES.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setForm((f) => ({ ...f, template_type: t.value }))}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs transition cursor-pointer ${
                      form.template_type === t.value
                        ? 'bg-[var(--anka-accent)]/15 text-[var(--anka-accent)] ring-1 ring-[var(--anka-accent)]/30'
                        : 'bg-[var(--anka-bg-tertiary)] text-[var(--anka-text-secondary)]'
                    }`}
                  >
                    <span>{t.icon}</span> {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Type-specific fields */}
            {form.template_type === 'task' && (
              <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-4 space-y-3">
                <div className="text-xs font-semibold text-[var(--anka-text-secondary)] uppercase">Task Fields</div>
                <Input label="Default Title" value={taskFields.title} onChange={(v) => setTaskFields((f) => ({ ...f, title: v }))} placeholder="Task title template" />
                <Input label="Description" value={taskFields.description} onChange={(v) => setTaskFields((f) => ({ ...f, description: v }))} placeholder="Default description" />
                <Select label="Priority" value={taskFields.priority} onChange={(v) => setTaskFields((f) => ({ ...f, priority: v }))} options={[
                  { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' },
                ]} />
              </div>
            )}

            {form.template_type === 'project' && (
              <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-4 space-y-3">
                <div className="text-xs font-semibold text-[var(--anka-text-secondary)] uppercase">Project Fields</div>
                <Input label="Default Name" value={projectFields.name} onChange={(v) => setProjectFields((f) => ({ ...f, name: v }))} placeholder="Project name template" />
                <Input label="Description" value={projectFields.description} onChange={(v) => setProjectFields((f) => ({ ...f, description: v }))} placeholder="Default description" />
                <Select label="Priority" value={projectFields.priority} onChange={(v) => setProjectFields((f) => ({ ...f, priority: v }))} options={[
                  { value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' },
                ]} />
              </div>
            )}

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_shared}
                onChange={(e) => setForm((f) => ({ ...f, is_shared: e.target.checked }))}
                className="w-4 h-4 rounded border-[var(--anka-border)] accent-[var(--anka-accent)]"
              />
              <span className="text-xs text-[var(--anka-text-secondary)]">Share with team</span>
            </label>
          </div>

          <button
            onClick={createTemplate}
            disabled={!form.name.trim()}
            className="w-full py-2.5 bg-[var(--anka-accent)] hover:bg-[var(--anka-accent-hover)] text-white text-sm font-medium rounded-xl transition cursor-pointer disabled:opacity-50"
          >
            Create Template
          </button>
        </div>
      )}

      {view === 'detail' && selectedTemplate && (
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-5">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <span className="text-3xl">{selectedTemplate.icon || TYPE_ICONS[selectedTemplate.template_type]}</span>
                <div>
                  <h3 className="font-semibold">{selectedTemplate.name}</h3>
                  <div className="text-xs text-[var(--anka-text-secondary)] mt-0.5 capitalize">{selectedTemplate.template_type} template</div>
                </div>
              </div>
              {selectedTemplate.is_shared && (
                <span className="text-[10px] px-2 py-0.5 bg-[var(--anka-accent)]/15 text-[var(--anka-accent)] rounded-full">shared</span>
              )}
            </div>

            {selectedTemplate.description && (
              <div className="text-sm text-[var(--anka-text-secondary)] mb-4">{selectedTemplate.description}</div>
            )}

            {/* Template data preview */}
            {selectedTemplate.template_data && Object.keys(selectedTemplate.template_data).length > 0 && (
              <div className="bg-[var(--anka-bg-tertiary)] rounded-lg p-3 mb-4">
                <div className="text-[10px] text-[var(--anka-text-secondary)] uppercase font-semibold mb-2">Fields</div>
                {Object.entries(selectedTemplate.template_data).map(([key, val]) => (
                  val ? (
                    <div key={key} className="flex justify-between text-xs py-1">
                      <span className="text-[var(--anka-text-secondary)] capitalize">{key.replace(/_/g, ' ')}</span>
                      <span className="truncate max-w-48">{String(val)}</span>
                    </div>
                  ) : null
                ))}
              </div>
            )}

            <div className="text-[10px] text-[var(--anka-text-secondary)]">
              Used {selectedTemplate.usage_count} times · Created {new Date(selectedTemplate.created_at).toLocaleDateString()}
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => useTemplate(selectedTemplate)}
              className="flex-1 py-2.5 bg-[var(--anka-accent)] hover:bg-[var(--anka-accent-hover)] text-white text-sm font-medium rounded-xl transition cursor-pointer"
            >
              Use Template
            </button>
            {selectedTemplate.created_by === user.id && (
              <button
                onClick={() => deleteTemplate(selectedTemplate.id)}
                className="px-4 py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm rounded-xl transition cursor-pointer"
              >
                Delete
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FilterBtn({ label, value, active, onClick }) {
  return (
    <button
      onClick={() => onClick(value)}
      className={`px-3 py-1.5 rounded-lg text-xs transition cursor-pointer ${
        active === value
          ? 'bg-[var(--anka-accent)]/15 text-[var(--anka-accent)]'
          : 'text-[var(--anka-text-secondary)] hover:bg-[var(--anka-bg-tertiary)]'
      }`}
    >
      {label}
    </button>
  );
}

function Input({ label, value, onChange, placeholder }) {
  return (
    <div>
      <label className="text-xs text-[var(--anka-text-secondary)] uppercase font-semibold block mb-1">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg text-sm text-[var(--anka-text-primary)] focus:outline-none focus:border-[var(--anka-accent)]"
      />
    </div>
  );
}

function Select({ label, value, onChange, options }) {
  return (
    <div>
      <label className="text-xs text-[var(--anka-text-secondary)] uppercase font-semibold block mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg text-sm text-[var(--anka-text-primary)] focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}
