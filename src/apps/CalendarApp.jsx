import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const PRIORITY_DOT = { low: 'bg-gray-400', medium: 'bg-blue-400', high: 'bg-orange-400', urgent: 'bg-red-400' };

export default function CalendarApp() {
  const { user } = useAuth();
  const today = new Date();
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [events, setEvents] = useState({}); // { 'YYYY-MM-DD': [{ title, type, priority }] }
  const [selectedDay, setSelectedDay] = useState(null);

  useEffect(() => { loadEvents(); }, [currentMonth, currentYear]);

  async function loadEvents() {
    const startDate = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-01`;
    const endDay = new Date(currentYear, currentMonth + 1, 0).getDate();
    const endDate = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;

    // Load tasks with due dates and campaigns/content with dates in this month
    const [
      { data: tasks },
      { data: campaigns },
      { data: content },
    ] = await Promise.all([
      supabase.from('tasks').select('title, due_date, priority, status')
        .gte('due_date', startDate).lte('due_date', endDate).eq('user_id', user.id),
      supabase.from('campaigns').select('name, start_date, end_date, status')
        .or(`start_date.gte.${startDate},end_date.lte.${endDate}`)
        .limit(50),
      supabase.from('content_items').select('title, publish_date, status')
        .gte('publish_date', startDate).lte('publish_date', endDate)
        .limit(50),
    ]);

    const map = {};
    function add(date, item) {
      if (!date) return;
      if (!map[date]) map[date] = [];
      map[date].push(item);
    }

    (tasks || []).forEach((t) => add(t.due_date, { title: t.title, type: 'task', priority: t.priority, status: t.status }));
    (campaigns || []).forEach((c) => {
      add(c.start_date, { title: `📊 ${c.name}`, type: 'campaign', status: c.status });
      if (c.end_date && c.end_date !== c.start_date) add(c.end_date, { title: `📊 ${c.name} (end)`, type: 'campaign', status: c.status });
    });
    (content || []).forEach((c) => add(c.publish_date, { title: `✏️ ${c.title}`, type: 'content', status: c.status }));

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

  return (
    <div className="h-full p-4 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <button onClick={prevMonth} className="w-8 h-8 rounded-lg hover:bg-[var(--anka-bg-secondary)] flex items-center justify-center text-[var(--anka-text-secondary)] transition cursor-pointer">←</button>
        <h2 className="text-lg font-semibold">{MONTHS[currentMonth]} {currentYear}</h2>
        <button onClick={nextMonth} className="w-8 h-8 rounded-lg hover:bg-[var(--anka-bg-secondary)] flex items-center justify-center text-[var(--anka-text-secondary)] transition cursor-pointer">→</button>
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
                      e.type === 'task' ? (PRIORITY_DOT[e.priority] || 'bg-blue-400') :
                      e.type === 'campaign' ? 'bg-pink-400' : 'bg-cyan-400'
                    }`} />
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
        <div className="mt-3 p-3 bg-[var(--anka-bg-secondary)] rounded-lg border border-[var(--anka-border)] max-h-36 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold">
              {MONTHS[currentMonth]} {selectedDay}, {currentYear}
            </h3>
            <button onClick={() => setSelectedDay(null)} className="text-[10px] text-[var(--anka-text-secondary)] hover:text-[var(--anka-text-primary)] cursor-pointer">✕</button>
          </div>
          {selectedEvents.length === 0 ? (
            <p className="text-[10px] text-[var(--anka-text-secondary)]">No events</p>
          ) : (
            <div className="space-y-1">
              {selectedEvents.map((e, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    e.type === 'task' ? (PRIORITY_DOT[e.priority] || 'bg-blue-400') :
                    e.type === 'campaign' ? 'bg-pink-400' : 'bg-cyan-400'
                  }`} />
                  <span className="truncate">{e.title}</span>
                  {e.status && <span className="text-[10px] text-[var(--anka-text-secondary)] ml-auto">{e.status}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
