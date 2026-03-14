import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

const STATUS_OPTIONS = ['draft', 'sent', 'paid', 'overdue', 'cancelled'];
const STATUS_COLORS = {
  draft: 'bg-gray-500/20 text-gray-400',
  sent: 'bg-blue-500/20 text-blue-400',
  paid: 'bg-green-500/20 text-green-400',
  overdue: 'bg-red-500/20 text-red-400',
  cancelled: 'bg-yellow-500/20 text-yellow-400',
};

export default function InvoicesApp() {
  const { user, profile } = useAuth();
  const [invoices, setInvoices] = useState([]);
  const [clients, setClients] = useState([]);
  const [projects, setProjects] = useState([]);
  const [view, setView] = useState('list'); // list | create | detail
  const [selected, setSelected] = useState(null);
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState({
    client_id: '', project_id: '', invoice_number: '', due_date: '',
    tax_rate: '0', notes: '', currency: 'USD',
  });
  const [lineItems, setLineItems] = useState([{ description: '', quantity: '1', unit_price: '' }]);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    const [invRes, cliRes, projRes] = await Promise.all([
      supabase.from('invoices')
        .select('*, clients(name, company), projects(name), profiles:created_by(full_name)')
        .order('created_at', { ascending: false }),
      supabase.from('clients').select('id, name, company').order('name'),
      supabase.from('projects').select('id, name').order('name'),
    ]);
    setInvoices(invRes.data || []);
    setClients(cliRes.data || []);
    setProjects(projRes.data || []);
    setLoading(false);
  }

  async function loadItems(invoiceId) {
    const { data } = await supabase.from('invoice_items')
      .select('*').eq('invoice_id', invoiceId).order('sort_order');
    setItems(data || []);
  }

  function calcTotals(lines, taxRate) {
    const subtotal = lines.reduce((acc, li) => acc + (parseFloat(li.quantity) || 0) * (parseFloat(li.unit_price) || 0), 0);
    const rate = parseFloat(taxRate) || 0;
    const tax = subtotal * (rate / 100);
    return { subtotal, tax_amount: tax, total: subtotal + tax };
  }

  async function createInvoice(e) {
    e.preventDefault();
    const totals = calcTotals(lineItems, form.tax_rate);
    const { data, error } = await supabase.from('invoices').insert([{
      created_by: user.id,
      client_id: form.client_id || null,
      project_id: form.project_id || null,
      invoice_number: form.invoice_number,
      due_date: form.due_date || null,
      tax_rate: parseFloat(form.tax_rate) || 0,
      notes: form.notes,
      currency: form.currency,
      subtotal: totals.subtotal,
      tax_amount: totals.tax_amount,
      total: totals.total,
    }]).select().single();

    if (!error && data) {
      const itemsToInsert = lineItems
        .filter((li) => li.description.trim())
        .map((li, i) => ({
          invoice_id: data.id,
          description: li.description,
          quantity: parseFloat(li.quantity) || 1,
          unit_price: parseFloat(li.unit_price) || 0,
          amount: (parseFloat(li.quantity) || 1) * (parseFloat(li.unit_price) || 0),
          sort_order: i,
        }));
      if (itemsToInsert.length > 0) {
        await supabase.from('invoice_items').insert(itemsToInsert);
      }
      resetForm();
      setView('list');
      loadData();
    }
  }

  async function updateStatus(id, status) {
    await supabase.from('invoices').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    loadData();
    if (selected?.id === id) setSelected({ ...selected, status });
  }

  async function deleteInvoice(id) {
    await supabase.from('invoices').delete().eq('id', id);
    setView('list'); setSelected(null);
    loadData();
  }

  function resetForm() {
    setForm({ client_id: '', project_id: '', invoice_number: '', due_date: '', tax_rate: '0', notes: '', currency: 'USD' });
    setLineItems([{ description: '', quantity: '1', unit_price: '' }]);
  }

  function openDetail(inv) {
    setSelected(inv);
    setView('detail');
    loadItems(inv.id);
  }

  function addLineItem() {
    setLineItems([...lineItems, { description: '', quantity: '1', unit_price: '' }]);
  }

  function updateLineItem(idx, field, value) {
    setLineItems(lineItems.map((li, i) => i === idx ? { ...li, [field]: value } : li));
  }

  function removeLineItem(idx) {
    if (lineItems.length <= 1) return;
    setLineItems(lineItems.filter((_, i) => i !== idx));
  }

  const filtered = filter === 'all' ? invoices : invoices.filter((i) => i.status === filter);
  const totals = calcTotals(lineItems, form.tax_rate);

  // Stats
  const totalOutstanding = invoices.filter((i) => ['sent', 'overdue'].includes(i.status)).reduce((a, i) => a + (i.total || 0), 0);
  const totalPaid = invoices.filter((i) => i.status === 'paid').reduce((a, i) => a + (i.total || 0), 0);

  // ─── List View ──────────────────────────────────────────────────────────────
  if (view === 'list') {
    return (
      <div className="h-full flex flex-col p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">🧾 Invoices</h2>
          <button onClick={() => { resetForm(); setView('create'); }}
            className="px-3 py-1.5 bg-[var(--anka-accent)] text-white text-sm rounded-lg hover:brightness-110 transition cursor-pointer">
            + New Invoice
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-[var(--anka-bg-secondary)] rounded-lg p-3 text-center">
            <div className="text-xs text-[var(--anka-text-secondary)]">Total Invoices</div>
            <div className="text-lg font-bold text-[var(--anka-accent)]">{invoices.length}</div>
          </div>
          <div className="bg-[var(--anka-bg-secondary)] rounded-lg p-3 text-center">
            <div className="text-xs text-[var(--anka-text-secondary)]">Outstanding</div>
            <div className="text-lg font-bold text-yellow-400">${totalOutstanding.toFixed(2)}</div>
          </div>
          <div className="bg-[var(--anka-bg-secondary)] rounded-lg p-3 text-center">
            <div className="text-xs text-[var(--anka-text-secondary)]">Paid</div>
            <div className="text-lg font-bold text-green-400">${totalPaid.toFixed(2)}</div>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 mb-4 overflow-x-auto">
          {['all', ...STATUS_OPTIONS].map((s) => (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-3 py-1 text-xs rounded-full whitespace-nowrap transition cursor-pointer ${filter === s ? 'bg-[var(--anka-accent)] text-white' : 'bg-[var(--anka-bg-secondary)] text-[var(--anka-text-secondary)]'}`}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {loading ? <p className="text-sm text-[var(--anka-text-secondary)]">Loading...</p> : (
          <div className="flex-1 overflow-y-auto space-y-2">
            {filtered.length === 0 && <p className="text-sm text-[var(--anka-text-secondary)]">No invoices found.</p>}
            {filtered.map((inv) => (
              <div key={inv.id} onClick={() => openDetail(inv)}
                className="bg-[var(--anka-bg-secondary)] rounded-lg p-4 hover:bg-[var(--anka-bg-tertiary)] transition cursor-pointer">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{inv.invoice_number}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[inv.status]}`}>{inv.status}</span>
                  </div>
                  <span className="text-sm font-bold">{inv.currency} {(inv.total || 0).toFixed(2)}</span>
                </div>
                <div className="text-xs text-[var(--anka-text-secondary)]">
                  {inv.clients?.name || inv.clients?.company || 'No client'}
                  {inv.projects?.name ? ` · ${inv.projects.name}` : ''}
                  {inv.due_date ? ` · Due ${inv.due_date}` : ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ─── Create View ───────────────────────────────────────────────────────────
  if (view === 'create') {
    return (
      <div className="h-full flex flex-col p-4 overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">New Invoice</h2>
          <button onClick={() => { setView('list'); resetForm(); }}
            className="text-sm text-[var(--anka-text-secondary)] hover:text-[var(--anka-text-primary)] cursor-pointer">← Back</button>
        </div>
        <form onSubmit={createInvoice} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--anka-text-secondary)] block mb-1">Invoice #</label>
              <input value={form.invoice_number} onChange={(e) => setForm({...form, invoice_number: e.target.value})}
                placeholder="INV-001" required
                className="w-full px-3 py-2 bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-lg text-sm focus:outline-none focus:border-[var(--anka-accent)]" />
            </div>
            <div>
              <label className="text-xs text-[var(--anka-text-secondary)] block mb-1">Due Date</label>
              <input type="date" value={form.due_date} onChange={(e) => setForm({...form, due_date: e.target.value})}
                className="w-full px-3 py-2 bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-lg text-sm focus:outline-none" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--anka-text-secondary)] block mb-1">Client</label>
              <select value={form.client_id} onChange={(e) => setForm({...form, client_id: e.target.value})}
                className="w-full px-3 py-2 bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-lg text-sm focus:outline-none">
                <option value="">No client</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name} {c.company ? `(${c.company})` : ''}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-[var(--anka-text-secondary)] block mb-1">Project</label>
              <select value={form.project_id} onChange={(e) => setForm({...form, project_id: e.target.value})}
                className="w-full px-3 py-2 bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-lg text-sm focus:outline-none">
                <option value="">No project</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>

          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-[var(--anka-text-secondary)] font-semibold uppercase">Line Items</label>
              <button type="button" onClick={addLineItem}
                className="text-xs text-[var(--anka-accent)] hover:underline cursor-pointer">+ Add item</button>
            </div>
            <div className="space-y-2">
              {lineItems.map((li, idx) => (
                <div key={idx} className="flex gap-2 items-center">
                  <input value={li.description} onChange={(e) => updateLineItem(idx, 'description', e.target.value)}
                    placeholder="Description" required
                    className="flex-1 px-3 py-2 bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-lg text-sm focus:outline-none" />
                  <input value={li.quantity} onChange={(e) => updateLineItem(idx, 'quantity', e.target.value)}
                    placeholder="Qty" type="number" min="0" step="0.01"
                    className="w-20 px-3 py-2 bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-lg text-sm focus:outline-none text-right" />
                  <input value={li.unit_price} onChange={(e) => updateLineItem(idx, 'unit_price', e.target.value)}
                    placeholder="Price" type="number" min="0" step="0.01"
                    className="w-24 px-3 py-2 bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-lg text-sm focus:outline-none text-right" />
                  <span className="w-24 text-right text-sm font-mono">
                    ${((parseFloat(li.quantity) || 0) * (parseFloat(li.unit_price) || 0)).toFixed(2)}
                  </span>
                  <button type="button" onClick={() => removeLineItem(idx)}
                    className="text-red-400 hover:text-red-300 text-xs cursor-pointer">✕</button>
                </div>
              ))}
            </div>
          </div>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-64 space-y-1 text-sm">
              <div className="flex justify-between"><span className="text-[var(--anka-text-secondary)]">Subtotal</span><span>${totals.subtotal.toFixed(2)}</span></div>
              <div className="flex justify-between items-center">
                <span className="text-[var(--anka-text-secondary)]">Tax</span>
                <div className="flex items-center gap-1">
                  <input value={form.tax_rate} onChange={(e) => setForm({...form, tax_rate: e.target.value})}
                    type="number" min="0" max="100" step="0.01"
                    className="w-16 px-2 py-1 bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded text-xs text-right focus:outline-none" />
                  <span className="text-xs">%</span>
                  <span className="ml-2">${totals.tax_amount.toFixed(2)}</span>
                </div>
              </div>
              <div className="flex justify-between font-bold border-t border-[var(--anka-border)] pt-1">
                <span>Total</span><span>${totals.total.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <textarea value={form.notes} onChange={(e) => setForm({...form, notes: e.target.value})}
            placeholder="Notes (optional)" rows={2}
            className="w-full px-3 py-2 bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-lg text-sm focus:outline-none resize-none" />

          <button type="submit"
            className="w-full py-2 bg-[var(--anka-accent)] text-white rounded-lg hover:brightness-110 transition cursor-pointer text-sm">
            Create Invoice
          </button>
        </form>
      </div>
    );
  }

  // ─── Detail View ───────────────────────────────────────────────────────────
  if (view === 'detail' && selected) {
    return (
      <div className="h-full flex flex-col p-4 overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => { setView('list'); setSelected(null); setItems([]); }}
            className="text-sm text-[var(--anka-text-secondary)] hover:text-[var(--anka-text-primary)] cursor-pointer">← Back</button>
          <div className="flex gap-2">
            <select value={selected.status} onChange={(e) => updateStatus(selected.id, e.target.value)}
              className="text-xs bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] rounded-lg px-2 py-1 focus:outline-none">
              {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
            <button onClick={() => deleteInvoice(selected.id)}
              className="px-3 py-1.5 bg-red-600/20 text-red-400 text-sm rounded-lg hover:bg-red-600/30 transition cursor-pointer">Delete</button>
          </div>
        </div>

        {/* Invoice header */}
        <div className="bg-[var(--anka-bg-secondary)] rounded-xl p-5 mb-4">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold">{selected.invoice_number}</h2>
              <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[selected.status]}`}>{selected.status}</span>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold text-[var(--anka-accent)]">{selected.currency} {(selected.total || 0).toFixed(2)}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <div className="text-xs text-[var(--anka-text-secondary)] mb-1">Client</div>
              <div>{selected.clients?.name || 'No client'} {selected.clients?.company ? `(${selected.clients.company})` : ''}</div>
            </div>
            <div>
              <div className="text-xs text-[var(--anka-text-secondary)] mb-1">Project</div>
              <div>{selected.projects?.name || 'No project'}</div>
            </div>
            <div>
              <div className="text-xs text-[var(--anka-text-secondary)] mb-1">Issued</div>
              <div>{selected.issue_date}</div>
            </div>
            <div>
              <div className="text-xs text-[var(--anka-text-secondary)] mb-1">Due</div>
              <div>{selected.due_date || '—'}</div>
            </div>
          </div>
        </div>

        {/* Line items */}
        <div className="bg-[var(--anka-bg-secondary)] rounded-xl p-5 mb-4">
          <h3 className="text-xs font-semibold text-[var(--anka-text-secondary)] uppercase mb-3">Items</h3>
          <div className="space-y-2">
            {items.length === 0 && <p className="text-xs text-[var(--anka-text-secondary)]">No items.</p>}
            {items.map((item) => (
              <div key={item.id} className="flex items-center justify-between text-sm">
                <span className="flex-1">{item.description}</span>
                <span className="w-16 text-right text-[var(--anka-text-secondary)]">×{item.quantity}</span>
                <span className="w-24 text-right text-[var(--anka-text-secondary)]">${(item.unit_price || 0).toFixed(2)}</span>
                <span className="w-24 text-right font-medium">${(item.amount || 0).toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-[var(--anka-border)] mt-3 pt-3 space-y-1 text-sm">
            <div className="flex justify-end"><span className="w-32 text-[var(--anka-text-secondary)]">Subtotal</span><span className="w-24 text-right">${(selected.subtotal || 0).toFixed(2)}</span></div>
            <div className="flex justify-end"><span className="w-32 text-[var(--anka-text-secondary)]">Tax ({selected.tax_rate}%)</span><span className="w-24 text-right">${(selected.tax_amount || 0).toFixed(2)}</span></div>
            <div className="flex justify-end font-bold"><span className="w-32">Total</span><span className="w-24 text-right">${(selected.total || 0).toFixed(2)}</span></div>
          </div>
        </div>

        {selected.notes && (
          <div className="bg-[var(--anka-bg-secondary)] rounded-xl p-5">
            <h3 className="text-xs font-semibold text-[var(--anka-text-secondary)] uppercase mb-2">Notes</h3>
            <p className="text-sm whitespace-pre-wrap">{selected.notes}</p>
          </div>
        )}
      </div>
    );
  }

  return null;
}
