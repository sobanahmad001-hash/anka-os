const KEY=/^[a-z][a-z0-9_]{0,63}$/
export const STAGE_ARTIFACT_TYPES=['discovery','vision','audience','brand_statement','website_architecture','keyword_strategy','content','campaign_messaging','scripts','channel_strategy','campaign_brief','measurement_plan','marketing_report','seo_research','technical_brief','launch_checklist','design_system','design_delivery_package']
const record=value=>value && typeof value==='object' && !Array.isArray(value)
const exact=(value,keys)=>record(value) && Object.keys(value).every(key=>keys.includes(key))
const target=value=>STAGE_ARTIFACT_TYPES.includes(value.artifact_type) && typeof value.output_type==='string' && KEY.test(value.output_type)
export function normalizePipelineStageContract(value) {
 if(!exact(value,['optional','output_label','reuse_allowed','artifact_type','output_type','required_inputs']) || typeof value.optional!=='boolean' || typeof value.reuse_allowed!=='boolean' || typeof value.output_label!=='string' || value.output_label!==value.output_label.trim() || !value.output_label || value.output_label.length>300 || !Array.isArray(value.required_inputs) || value.required_inputs.length>8 || (value.reuse_allowed ? !target(value) : 'artifact_type' in value || 'output_type' in value))throw new TypeError('Stage output, optional/reuse rules and required inputs must be explicit')
 const seen=new Set()
 const required_inputs=value.required_inputs.map(input=>{
  if(!exact(input,['key','label','kind','artifact_type','output_type']) || typeof input.key!=='string' || !KEY.test(input.key) || seen.has(input.key) || typeof input.label!=='string' || input.label!==input.label.trim() || !input.label || input.label.length>160 || !['manual','approved_artifact'].includes(input.kind) || (input.kind==='approved_artifact' ? !target(input) : 'artifact_type' in input || 'output_type' in input))throw new TypeError('Required input needs a unique key, label and exact supported source')
  seen.add(input.key);return {...input}
 })
 return {...value,required_inputs}
}

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function inspectPipelineStagePlan(steps,quantities,actions={},reasons={},values={},artifacts=[]) {
 const decisions=[],selectedSteps=[],rows=[],errors=[],seen=new Set(),selectedServices=new Set()
 for(const step of steps){const action=actions[step.key] || (quantities[step.key] ? 'run' : 'outside_scope');if(['run','reuse'].includes(action))selectedServices.add(step.service_id)}
 for(const step of steps) {
  const contract=step.stage_contract===undefined ? null : normalizePipelineStageContract(step.stage_contract)
  const action=actions[step.key] || (quantities[step.key] ? 'run' : 'outside_scope'),row={step,contract,action,inputs:[]};rows.push(row)
  if(action==='outside_scope') {decisions.push({key:step.key,action});if(contract && selectedServices.has(step.service_id))errors.push(`${step.label}: resolve this declared stage of the selected service`);continue}
  if(action==='omit') {const reason=(reasons[step.key]||'').trim();decisions.push({key:step.key,action,reason});if(!contract?.optional || !reason || reason.length>1000)errors.push(`${step.label}: omission requires a declared optional stage and reason`);continue}
  if(!['run','reuse'].includes(action)){errors.push(`${step.label}: unsupported stage decision`);continue}
  if((step.depends_on||[]).some(key=>!seen.has(key)))errors.push(`${step.label}: requires its earlier steps included or satisfied`)
  if(action==='reuse') {
   const versionId=values[step.key]?.artifact_version_id,source=artifacts.find(row=>row.artifact_version_id===versionId)
   row.source=source
   decisions.push({key:step.key,action,artifact_version_id:versionId||''});selectedSteps.push({key:step.key,quantity:1})
   if(!contract?.reuse_allowed || step.kind==='approval_gate' || !UUID.test(versionId||'') || !source || source.artifact_type!==contract.artifact_type || source.output_type!==contract.output_type)errors.push(`${step.label}: choose an exact compatible approved artifact version`)
  } else {
   const quantity=Number(quantities[step.key]);if(!Number.isInteger(quantity) || quantity<1 || quantity>50)errors.push(`${step.label}: quantity must be 1–50`)
   const inputs=(contract?.required_inputs||[]).map(required=>{
    const value=values[step.key]?.[required.key]||'',source=artifacts.find(row=>row.artifact_version_id===value)
    const missing=required.kind==='manual' ? typeof value!=='string' || !value.trim() || value.length>1000 : !UUID.test(value) || !source || source.artifact_type!==required.artifact_type || source.output_type!==required.output_type || (['ai_assisted','automatic'].includes(step.kind) && source.ai_use_allowed!==true)
    row.inputs.push({required,value,source,missing});if(missing)errors.push(`${step.label}: missing or incompatible ${required.label}`)
    return required.kind==='manual' ? {key:required.key,value} : {key:required.key,artifact_version_id:value}
   })
   decisions.push({key:step.key,action,quantity,inputs});selectedSteps.push({key:step.key,quantity})
  }
  seen.add(step.key)
 }
 if(!selectedSteps.length || selectedSteps.reduce((sum,row)=>sum+row.quantity,0)>50)errors.push('Choose included or reused steps with a total quantity of 1–50')
 return {decisions,selectedSteps,rows,errors,ready:errors.length===0}
}
