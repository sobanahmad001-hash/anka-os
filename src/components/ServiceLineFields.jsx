const recurring=new Set(['weekly','monthly','quarterly'])
export default function ServiceLineFields({item,groups,onChange}){
 const line=item.service_line,update=(key,value)=>onChange({...line,[key]:value})
 return <section className="setup-service-line" aria-label="Service dates and scope">
  <h4>Dates and scope</h4>
  <div className="setup-service-line-grid">
   <label>Business scope<select aria-label="Service business scope" value={line.service_group} onChange={e=>update('service_group',e.target.value)}><option value="">Choose a scope</option>{groups.map(group=><option key={group.id} value={group.id}>{group.label}</option>)}</select></label>
   <label>Start date<input aria-label="Service start date" type="date" value={line.start_date} onChange={e=>update('start_date',e.target.value)}/></label>
   <label>Target date (optional)<input aria-label="Service target date" type="date" value={line.target_date||''} onChange={e=>update('target_date',e.target.value||null)}/></label>
   <label>Timezone<input aria-label="Service timezone" placeholder="e.g. Asia/Karachi or UTC" maxLength={100} value={line.timezone} onChange={e=>update('timezone',e.target.value)}/></label>
   {recurring.has(item.cadence)&&<label>Planned cycles (intent only)<input aria-label="Planned cycles" type="number" min="1" max="12" value={line.generation_horizon??''} onChange={e=>update('generation_horizon',e.target.value===''?null:Number(e.target.value))}/></label>}
  </div>
  {!groups.length&&<p role="status">This service has no reviewed business scope. Its mapping must be resolved before a dates-and-scope proposal can be saved.</p>}
  <label>Included work<textarea aria-label="Service included work" maxLength={4000} value={line.scope_statement} onChange={e=>update('scope_statement',e.target.value)}/></label>
  <label>Exclusions (optional)<textarea aria-label="Service exclusions" maxLength={4000} value={line.exclusions} onChange={e=>update('exclusions',e.target.value)}/></label>
  <p className="setup-service-intent">Dates and planned cycles record intent only. They do not schedule work, generate cycles or enable execution.</p>
 </section>
}
export function ServiceLineReview({before,after}){
 if(!after)return null
 const fields=[['Business scope','service_group'],['Start date','start_date'],['Target date','target_date'],['Timezone','timezone'],['Planned cycles (intent only)','generation_horizon'],['Included work','scope_statement'],['Exclusions','exclusions']]
 return <dl className="setup-service-diff" aria-label="Reviewed service dates and scope">{fields.map(([label,key])=><div key={key}><dt>{label}</dt><dd>{before&&<><span>{before[key]??'Not set'}</span><span aria-label="changes to"> → </span></>}<strong>{after[key]===null||after[key]===''?'Not set':after[key]}</strong></dd></div>)}</dl>
}
