import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const PRIORITY_DOT = { low: 'bg-gray-400', medium: 'bg-blue-400', high: 'bg-orange-400', urgent: 'bg-red-400' };
const EVENT_COLORS = ['#6c5ce7', '#00b894', '#e17055', '#0984e3', '#fdcb6e', '#e84393', '#00cec9', '#636e72'];

export default function CalendarApp() {
  const { user } = useAuth();
  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [events, setEvents] = useState({}); // { 'YYYY-MM-DD': [{ title, type, priority, id? }] }
  const [selectedDay, setSelectedDay] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', start_time: '', end_time: '', all_day: true, color: '#6c5ce7', is_shared: false });

  useEffect(() => { loadEvents(); }, [currentMonth, currentYear]);

  async function loadEvents() {
    const startDate = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-01`;
    const endDay = new Date(currentYear, currentMonth + 1, 0).getDate();
    const endDate = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;

    const [
      { data: tasks },
      { data: campaigns },
      { data: content },
      { data: calEvents },
    ] = await Promise.all([
      supabase.from('tasks').select('title, due_date, priority, status')
        .gte('due_date', startDate).lte('due_date', endDate).eq('user_id', user.id),
      supabase.from('campaigns').select('name, start_date, end_date, status')
        .or(`start_date.gte.${startDate},end_date.lte.${endDate}`)
        .limit(50),
      supabase.from('content_items').select('title, publish_date, status')
        .gte('publish_date', startDate).lte('publish_date', endDate)
        .limit(50),
      supabase.from('calendar_events').select('*')
        .gte('start_time', startDate + 'T00:00:00')
        .lte('start_time', endDate + 'T23:59:59')
        .or(`user_id.eq.${user.id},is_shared.eq.true`),
    ]);

    const map = {};
    function add(date, item) {
      if (!date) return;
      const d = date.includes('T') ? date.split('T')[0] : date;
      if (!map[d]) map[d] = [];
      map[d].push(item);
    }

    (tasks || []).forEach((t) => add(t.due_date, { title: t.title, type: 'task', priority: t.priority, status: t.status }));
    (campaigns || []).forEach((c) => {
      add(c.start_date, { title: `📊 ${c.name}`, type: 'campaign', status: c.status });
      if (c.end_date && c.end_date !== c.start_date) add(c.end_date, { title: `📊 ${c.name} (end)`, type: 'campaign', status: c.status });
    });
    (content || []).forEach((c) => add(c.publish_date, { title: `✏️ ${c.title}`, type: 'content', status: c.status }));
    (calEvents || []).forEach((e) => add(e.start_time, { id: e.id, title: `🗓️ ${e.title}`, type: 'event', color: e.color, description: e.description, is_shared: e.is_shared }));

    setEvents(map);
  }

  function getDaysInMonth(month, year) { return new Date(year, month + 1, 0).getDate(); }
  function getFirstDayOfMonth(month, year) { return new Date(year, month, 1).getDay(); }

  function prevMonth() {
    if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear(currentYear - 1); }
    else setCurrentMonth(currentMonth - 1);
    setSelectedDay(null);
  }

  function nextMonth() {
    if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear(currentYear + 1); }
    else setCurrentMonth(currentMonth + 1);
    setSelectedDay(null);
  }

  function goToToday() {
    setCurrentMonth(today.getMonth());
    setCurrentYear(today.getFullYear());
    setSelectedDay(today.getDate());
  }

  const daysInMonth = getDaysInMonth(currentMonth, currentYear);
  const firstDay = getFirstDayOfMonth(currentMonth, currentYear);
  const days = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let d = 1; d <= daysInMonth; d++) days.push(d);

  const isToday = (day) => day === today.getDate() && currentMonth === today.getMonth() && currentYear === today.getFullYear();

  function dateKey(day) {
    return `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const selectedEvents = selectedDay ? (events[dateKey(selectedDay)] || []) : [];

  async function createEvent(e) {
    e.preventDefault();
    if (!form.title.trim() || !selectedDay) return;
    const dk = dateKey(selectedDay);
    const startTime = form.all_day ? dk + 'T09:00:00' : dk + 'T' + (form.start_time || '09:00') + ':00';
    const endTime = form.all_day ? dk + 'T17:00:00' : (form.end_time ? dk + 'T' + form.end_time + ':00' : null);
    await supabase.from('calendar_events').insert({
      user_id: user.id,
      title: form.title.trim(),
      description: form.description.trim(),
      start_time: startTime,
      end_time: endTime,
      all_day: form.all_day,
      color: form.color,
      is_shared: form.is_shared,
    });
    setForm({ title: '', description: '', start_time: '', end_time: '', all_day: true, color: '#6c5ce7', is_shared: false });
    setShowCreate(false);
    loadEvents();
  }

  async function deleteEvent(eventId) {
    await supabase.from('calendar_events').delete().eq('id', eventId);
    loadEvents();
  }

  return (
    <div className="h-full p-4 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="w-8 h-8 rounded-lg hover:bg-[var(--anka-bg-secondary)] flex items-center justify-center text-[var(--anka-text-secondary)] transition cursor-pointer">←</button>
          <h2 className="text-lg font-semibold">{MONTHS[currentMonth]} {currentYear}</h2>
          <button onClick={nextMonth} className="w-8 h-8 rounded-lg hover:bg-[var(--anka-bg-secondary)] flex items-center justify-center text-[var(--anka-text-secondary)] transition cursor-pointer">→</button>
        </div>
        <div className="flex gap-2">
          <button onClick={goToToday}
            className="text-[10px] px-2.5 py-1 rounded-full bg-[var(--anka-bg-secondary)] text-[var(--anka-text-secondary)] hover:text-[var(--anka-text-primary)] transition cursor-pointer">Today</button>
        </div>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {DAYS.map((d) => (
          <div key={d} className="text-center text-[10px] font-semibold text-[var(--anka-text-secondary)] uppercase py-1">{d}</div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-1 flex-1">
        {days.map((day, i) => {
          if (day === null) return <div key={i} />;
          const key = dateKey(day);
          const dayEvents = events[key] || [];
          const active = isToday(day);
          const isSelected = selectedDay === day;

          return (
            <div key={i} onClick={() => setSelectedDay(day)}
              className={`rounded-lg p-1 text-xs transition cursor-pointer flex flex-col ${
                active ? 'bg-[var(--anka-accent)] text-white font-bold' :
                isSelected ? 'bg-[var(--anka-accent)]/20 ring-1 ring-[var(--anka-accent)]' :
                'hover:bg-[var(--anka-bg-secondary)]'
              }`}
            >
              <span className="text-center">{day}</span>
              {dayEvents.length > 0 && (
                <div className="flex gap-0.5 justify-center mt-0.5 flex-wrap">
                  {dayEvents.slice(0, 3).map((e, j) => (
                    <span key={j} className={`w-1.5 h-1.5 rounded-full ${
                      e.type === 'event' ? '' :
                      e.type === 'task' ? (PRIORITY_DOT[e.priority] || 'bg-blue-400') :
                      e.type === 'campaign' ? 'bg-pink-400' : 'bg-cyan-400'
                    }`} style={e.type === 'event' ? { backgroundColor: e.color || '#6c5ce7' } : {}} />
                  ))}
                  {dayEvents.length > 3 && <span className="text-[8px] text-[var(--anka-text-secondary)]">+{dayEvents.length - 3}</span>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Selected day detail */}
      {selectedDay && (
        <div className="mt-3 p-3 bg-[var(--anka-bg-secondary)] rounded-lg border border-[var(--anka-border)] max-h-52 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold">
              {MONTHS[currentMonth]} {selectedDay}, {currentYear}
            </h3>
            <div className="flex gap-2">
              <button onClick={() => setShowCreate(!showCreate)}
                className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--anka-accent)] text-white hover:brightness-110 transition cursor-pointer">+ Event</button>
              <button onClick={() => { setSelectedDay(null); setShowCreate(false); }} className="text-[10px] text-[var(--anka-text-secondary)] hover:text-[var(--anka-text-primary)] cursor-pointer">✕</button>
            </div>
          </div>

          {/* New event form */}
          {showCreate && (
            <form onSubmit={createEvent} className="mb-3 p-2 bg-[var(--anka-bg-primary)] rounded-lg space-y-1.5">
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Event title" className="w-full text-xs px-2 py-1 rounded bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] text-[var(--anka-text-primary)]" />
              <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Description (optional)" className="w-full text-xs px-2 py-1 rounded bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] text-[var(--anka-text-primary)]" />
              <div className="flex items-center gap-2 flex-wrap">
                <label className="flex items-center gap-1 text-[10px] text-[var(--anka-text-secondary)]">
                  <input type="checkbox" checked={form.all_day} onChange={(e) => setForm({ ...form, all_day: e.target.checked })} /> All day
                </label>
                {!form.all_day && (
                  <>
                    <input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })}
                      className="text-[10px] px-1 py-0.5 rounded bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] text-[var(--anka-text-primary)]" />
                    <span className="text-[10px] text-[var(--anka-text-secondary)]">to</span>
                    <input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })}
                      className="text-[10px] px-1 py-0.5 rounded bg-[var(--anka-bg-secondary)] border border-[var(--anka-border)] text-[var(--anka-text-primary)]" />
                  </>
                )}
                <div className="flex gap-1 ml-auto">
                  {EVENT_COLORS.map((c) => (
                    <button key={c} type="button" onClick={() => setForm({ ...form, color: c })}
                      className={`w-4 h-4 rounded-full cursor-pointer ${form.color === c ? 'ring-2 ring-white ring-offset-1 ring-offset-[var(--anka-bg-primary)]' : ''}`}
                      style={{ backgroundColor: c }} />
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-[10px] text-[var(--anka-text-secondary)]">
                  <input type="checkbox" checked={form.is_shared} onChange={(e) => setForm({ ...form, is_shared: e.target.checked })} /> Share with team
                </label>
                <button type="submit" className="ml-auto text-[10px] px-2 py-0.5 rounded bg-[var(--anka-accent)] text-white cursor-pointer">Create</button>
              </div>
            </form>
          )}

          {selectedEvents.length === 0 && !showCreate ? (
            <p className="text-[10px] text-[var(--anka-text-secondary)]">No events</p>
          ) : (
            <div className="space-y-1">
              {selectedEvents.map((e, i) => (
                <div key={i} className="flex items-center gap-2 text-xs group">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    e.type === 'event' ? '' :
                    e.type === 'task' ? (PRIORITY_DOT[e.priority] || 'bg-blue-400') :
                    e.type === 'campaign' ? 'bg-pink-400' : 'bg-cyan-400'
                  }`} style={e.type === 'event' ? { backgroundColor: e.color || '#6c5ce7' } : {}} />
                  <span className="truncate flex-1">{e.title}</span>
                  {e.is_shared && <span className="text-[9px] text-[var(--anka-accent)]">shared</span>}
                  {e.status && <span className="text-[10px] text-[var(--anka-text-secondary)]">{e.status}</span>}
                  {e.type === 'event' && e.id && (
                    <button onClick={() => deleteEvent(e.id)}
                      className="text-[10px] text-[var(--anka-text-secondary)] opacity-0 group-hover:opacity-100 hover:text-red-400 transition cursor-pointer">✕</button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
