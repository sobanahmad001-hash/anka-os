import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

const CATEGORIES = [
  { value: 'general', label: 'General', icon: '👤' },
  { value: 'client', label: 'Client', icon: '🤝' },
  { value: 'vendor', label: 'Vendor', icon: '🏭' },
  { value: 'partner', label: 'Partner', icon: '🤲' },
  { value: 'lead', label: 'Lead', icon: '🎯' },
  { value: 'other', label: 'Other', icon: '📌' },
];

const CATEGORY_ICONS = {};
CATEGORIES.forEach((c) => { CATEGORY_ICONS[c.value] = c.icon; });

export default function ContactsApp() {
  const { user } = useAuth();
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('list'); // list | create | detail
  const [selectedContact, setSelectedContact] = useState(null);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [form, setForm] = useState({
    name: '', email: '', phone: '', company: '', role: '',
    category: 'general', notes: '', is_shared: false,
  });

  useEffect(() => { loadContacts(); }, []);

  async function loadContacts() {
    setLoading(true);
    const { data } = await supabase
      .from('contacts')
      .select('*')
      .order('name');
    if (data) setContacts(data);
    setLoading(false);
  }

  async function createContact(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    await supabase.from('contacts').insert([{
      created_by: user.id,
      name: form.name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      company: form.company.trim(),
      role: form.role.trim(),
      category: form.category,
      notes: form.notes.trim(),
      is_shared: form.is_shared,
    }]);
    setForm({ name: '', email: '', phone: '', company: '', role: '', category: 'general', notes: '', is_shared: false });
    setView('list');
    loadContacts();
  }

  async function deleteContact(id) {
    await supabase.from('contacts').delete().eq('id', id);
    setSelectedContact(null);
    setView('list');
    loadContacts();
  }

  const filtered = contacts.filter((c) => {
    const matchSearch = !search || c.name.toLowerCase().includes(search.toLowerCase())
      || c.email?.toLowerCase().includes(search.toLowerCase())
      || c.company?.toLowerCase().includes(search.toLowerCase());
    const matchCategory = filterCategory === 'all' || c.category === filterCategory;
    return matchSearch && matchCategory;
  });

  // Group by first letter
  const grouped = {};
  filtered.forEach((c) => {
    const letter = (c.name[0] || '#').toUpperCase();
    if (!grouped[letter]) grouped[letter] = [];
    grouped[letter].push(c);
  });
  const sortedLetters = Object.keys(grouped).sort();

  if (loading) {
    return <div className="h-full flex items-center justify-center text-sm text-[var(--anka-text-secondary)]">Loading contacts...</div>;
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-5 py-3 border-b border-[var(--anka-border)] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold">Contacts</h2>
          {view !== 'list' && (
            <button onClick={() => { setView('list'); setSelectedContact(null); }} className="text-xs text-[var(--anka-accent)] hover:text-[var(--anka-accent-hover)] cursor-pointer">
              ← Back
            </button>
          )}
        </div>
        {view === 'list' && (
          <button onClick={() => setView('create')} className="px-3 py-1.5 bg-[var(--anka-accent)] hover:bg-[var(--anka-accent-hover)] text-white text-xs rounded-lg transition cursor-pointer">
            + Add Contact
          </button>
        )}
      </div>

      {/* List view */}
      {view === 'list' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Search + Filters */}
          <div className="px-5 py-3 space-y-2 border-b border-[var(--anka-border)]">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search contacts..."
              className="w-full px-3 py-2 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg text-sm text-[var(--anka-text-primary)] placeholder-[var(--anka-text-secondary)] focus:outline-none focus:border-[var(--anka-accent)]"
            />
            <div className="flex gap-1.5 flex-wrap">
              <CatBtn label="All" value="all" active={filterCategory} onClick={setFilterCategory} />
              {CATEGORIES.map((c) => (
                <CatBtn key={c.value} label={c.label} value={c.value} active={filterCategory} onClick={setFilterCategory} />
              ))}
            </div>
          </div>

          {/* Contact list */}
          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="p-10 text-center">
                <div className="text-3xl mb-2">📇</div>
                <div className="text-sm text-[var(--anka-text-secondary)]">No contacts found</div>
              </div>
            ) : (
              <div className="pb-4">
                {sortedLetters.map((letter) => (
                  <div key={letter}>
                    <div className="px-5 py-1.5 text-[10px] font-semibold text-[var(--anka-text-secondary)] uppercase bg-[var(--anka-bg-primary)] sticky top-0">
                      {letter}
                    </div>
                    {grouped[letter].map((contact) => (
                      <button
                        key={contact.id}
                        onClick={() => { setSelectedContact(contact); setView('detail'); }}
                        className="w-full text-left px-5 py-3 flex items-center gap-3 hover:bg-[var(--anka-bg-tertiary)]/50 transition cursor-pointer border-b border-[var(--anka-border)] last:border-0"
                      >
                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[var(--anka-accent)] to-purple-500 flex items-center justify-center text-xs font-bold shrink-0">
                          {contact.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{contact.name}</div>
                          <div className="text-[10px] text-[var(--anka-text-secondary)] truncate">
                            {contact.company ? `${contact.role ? contact.role + ' at ' : ''}${contact.company}` : contact.email || contact.category}
                          </div>
                        </div>
                        <span className="text-sm shrink-0">{CATEGORY_ICONS[contact.category] || '👤'}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer count */}
          <div className="px-5 py-2 border-t border-[var(--anka-border)] text-[10px] text-[var(--anka-text-secondary)]">
            {filtered.length} contact{filtered.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}

      {/* Create view */}
      {view === 'create' && (
        <form onSubmit={createContact} className="flex-1 overflow-y-auto p-5 space-y-4">
          <h3 className="text-sm font-semibold">New Contact</h3>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name *" value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} placeholder="Full name" required />
            <Field label="Email" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} placeholder="email@example.com" type="email" />
            <Field label="Phone" value={form.phone} onChange={(v) => setForm((f) => ({ ...f, phone: v }))} placeholder="+1 555 123 4567" />
            <Field label="Company" value={form.company} onChange={(v) => setForm((f) => ({ ...f, company: v }))} placeholder="Company name" />
            <Field label="Role / Title" value={form.role} onChange={(v) => setForm((f) => ({ ...f, role: v }))} placeholder="CEO, Designer, etc." />
            <div>
              <label className="text-xs text-[var(--anka-text-secondary)] uppercase font-semibold block mb-1">Category</label>
              <select
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                className="w-full px-3 py-2 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg text-sm text-[var(--anka-text-primary)] focus:outline-none"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.icon} {c.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs text-[var(--anka-text-secondary)] uppercase font-semibold block mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="Add notes..."
              rows={3}
              className="w-full px-3 py-2 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg text-sm text-[var(--anka-text-primary)] placeholder-[var(--anka-text-secondary)] focus:outline-none focus:border-[var(--anka-accent)] resize-none"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.is_shared} onChange={(e) => setForm((f) => ({ ...f, is_shared: e.target.checked }))} className="w-4 h-4 rounded accent-[var(--anka-accent)]" />
            <span className="text-xs text-[var(--anka-text-secondary)]">Share with team</span>
          </label>
          <button type="submit" disabled={!form.name.trim()} className="w-full py-2.5 bg-[var(--anka-accent)] hover:bg-[var(--anka-accent-hover)] text-white text-sm font-medium rounded-xl transition cursor-pointer disabled:opacity-50">
            Add Contact
          </button>
        </form>
      )}

      {/* Detail view */}
      {view === 'detail' && selectedContact && (
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div className="bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-xl p-5">
            <div className="flex items-center gap-4 mb-5">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[var(--anka-accent)] to-purple-500 flex items-center justify-center text-2xl font-bold">
                {selectedContact.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold">{selectedContact.name}</h3>
                {selectedContact.role && (
                  <div className="text-sm text-[var(--anka-text-secondary)]">
                    {selectedContact.role}{selectedContact.company ? ` at ${selectedContact.company}` : ''}
                  </div>
                )}
                <span className="text-[10px] px-2 py-0.5 bg-[var(--anka-bg-tertiary)] rounded-full text-[var(--anka-text-secondary)] capitalize mt-1 inline-block">
                  {CATEGORY_ICONS[selectedContact.category]} {selectedContact.category}
                </span>
              </div>
            </div>

            <div className="space-y-3 pt-4 border-t border-[var(--anka-border)]">
              {selectedContact.email && (
                <DetailRow icon="✉️" label="Email" value={selectedContact.email} />
              )}
              {selectedContact.phone && (
                <DetailRow icon="📞" label="Phone" value={selectedContact.phone} />
              )}
              {selectedContact.company && (
                <DetailRow icon="🏢" label="Company" value={selectedContact.company} />
              )}
              {selectedContact.notes && (
                <div className="pt-2">
                  <div className="text-[10px] text-[var(--anka-text-secondary)] uppercase font-semibold mb-1">Notes</div>
                  <div className="text-sm text-[var(--anka-text-secondary)] whitespace-pre-wrap">{selectedContact.notes}</div>
                </div>
              )}
            </div>

            <div className="mt-4 pt-3 border-t border-[var(--anka-border)] flex items-center justify-between text-[10px] text-[var(--anka-text-secondary)]">
              <span>Added {new Date(selectedContact.created_at).toLocaleDateString()}</span>
              {selectedContact.is_shared && <span className="text-[var(--anka-accent)]">Shared</span>}
            </div>
          </div>

          {selectedContact.created_by === user.id && (
            <button
              onClick={() => deleteContact(selectedContact.id)}
              className="w-full py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm font-medium rounded-xl transition cursor-pointer"
            >
              Delete Contact
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CatBtn({ label, value, active, onClick }) {
  return (
    <button
      onClick={() => onClick(value)}
      className={`px-2.5 py-1 rounded-lg text-[10px] transition cursor-pointer ${
        active === value ? 'bg-[var(--anka-accent)]/15 text-[var(--anka-accent)]' : 'text-[var(--anka-text-secondary)] hover:bg-[var(--anka-bg-tertiary)]'
      }`}
    >
      {label}
    </button>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text', required = false }) {
  return (
    <div>
      <label className="text-xs text-[var(--anka-text-secondary)] uppercase font-semibold block mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full px-3 py-2 bg-[var(--anka-bg-tertiary)] border border-[var(--anka-border)] rounded-lg text-sm text-[var(--anka-text-primary)] placeholder-[var(--anka-text-secondary)] focus:outline-none focus:border-[var(--anka-accent)]"
      />
    </div>
  );
}

function DetailRow({ icon, label, value }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm">{icon}</span>
      <div>
        <div className="text-[10px] text-[var(--anka-text-secondary)] uppercase">{label}</div>
        <div className="text-sm">{value}</div>
      </div>
    </div>
  );
}
