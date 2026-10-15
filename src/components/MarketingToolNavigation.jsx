const GROUPS = [
  ['Plan & create', ['overview', 'brief', 'campaigns', 'calendar', 'artifacts', 'chat']],
  ['Research & improve', ['seo-research', 'seo-keywords', 'backlinks']],
  ['Measure & connect', ['ad-tracking', 'analytics', 'reports', 'connections']],
]

// Presentation only; the host retains guarded navigation and all existing route values.
export default function MarketingToolNavigation({ tabs, value, onChange }) {
  const known = new Set(GROUPS.flatMap(([, ids]) => ids))
  const extra = tabs.filter(([id]) => !known.has(id))
  return <nav aria-label="Marketing tools" className="marketing-tool-navigation">
    <label>Tool
      <select aria-label="Marketing tool" value={value} onChange={event => onChange(event.target.value)}>
        {GROUPS.map(([label, ids]) => <optgroup label={label} key={label}>
          {tabs.filter(([id]) => ids.includes(id)).map(([id, title]) => <option key={id} value={id}>{title}</option>)}
        </optgroup>)}
        {extra.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
      </select>
    </label>
    <p>Saved work stays in this engagement. Open Workshop to continue the conversation.</p>
  </nav>
}
