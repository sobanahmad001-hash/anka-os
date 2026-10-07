const label = field => ({ original_date: 'Source date', historical_status: 'Source status', status_evidence: 'Status evidence', due_date: 'Reviewed deadline', start_date: 'Reviewed start', calendar_key: 'Import key', planned_path: 'Page path', record_kind: 'Work record' }[field] || field.replaceAll('_', ' '))
const text = value => value === null || value === undefined || value === '' ? 'Not provided' : ({engagement_work_item:'Marketing engagement work item',project_task:'Project task',not_started:'Not started'}[value]||String(value))
const actionLabel = action => ({ create: 'Add', update: 'Update', skip: 'Keep unchanged', error: 'Resolve before import' }[action] || 'Review')
export function SpreadsheetRowReview({ preview, local=false }) {
 const rows=preview?.rows||[],commands=preview?.canonical_payload?.rows||[]
 return <section aria-label={local?'Spreadsheet row preview':'Reviewed changes'}>
  <p>{rows.length} source rows · {local?'Local mapping inspection':'Review the exact changes before saving'}</p>
  {preview?.engagement_label&&<p>Workstream: {preview.engagement_label}{preview.artifact_label?` · ${preview.artifact_label}`:''}</p>}
  <div className="project-import-rows">{rows.map((row,i)=>{
   const command=commands.find(x=>x.row_id===row.rowId),action=command?.action||row.action
   return <article className="project-import-row" key={row.rowId||i}>
    <h4>{row.values?.title||row.values?.term||`Source row ${row.source?.row||i+2}`}</h4>
    <p><strong>{actionLabel(action)}</strong> · {row.source?.sheet||'Selected sheet'}, row {row.source?.row||i+2}</p>
    <dl>{Object.entries(row.values||{}).filter(([field])=>field!=='record_id').map(([field,value])=><div key={field}><dt>{label(field)}</dt><dd>{row.before&&Object.hasOwn(row.before,field)&&row.before[field]!==value?<><span>{text(row.before[field])}</span> → <strong>{text(value)}</strong></>:text(value)}</dd></div>)}</dl>
    {(row.errors||[]).map((error,j)=><p key={'e'+j} className="project-import-warning">{error}</p>)}
    {(row.warnings||[]).map((warning,j)=><p key={'w'+j}>{warning}</p>)}
   </article>
  })}</div>
 </section>
}
export function SpreadsheetResults({ result, preview }) {
 const rows=result?.rows||[]
 return <section aria-label="Import results"><h4>Import results</h4>
  <p>{rows.filter(r=>r.outcome==='verified').length} verified · {rows.filter(r=>r.outcome==='error').length} need another review</p>
  {rows.map((row,i)=>{const source=preview?.rows?.find(r=>r.rowId===row.row_id);return <article className="project-import-row" key={row.row_id||i}>
   <strong>{source?.values?.title||source?.values?.term||`Source row ${source?.source?.row||i+2}`}</strong>
   <p>{row.outcome==='verified'?(row.action==='skip'?'Kept unchanged':row.result?.unapproved?'Unapproved draft saved':row.action==='create'?'Unassigned Marketing work added':'Reviewed change saved'):'Could not complete this row. Review current project work before trying it again.'}</p>
  </article>})}
  <p>Successful rows are complete. Review only failed rows in a new batch; recovering this receipt repeats no writes.</p>
 </section>
}
export function SpreadsheetDisclosure({ payload }) {
 return <section aria-label="Exact AI sample disclosure">{(payload?.headers||[]).map((header,i)=><article className="project-import-row" key={i}><strong>{header}</strong><ol>{(payload.samples||[]).map((row,j)=><li key={j}>{text(row[i])}</li>)}</ol></article>)}</section>
}
