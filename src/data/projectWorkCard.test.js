import test from 'node:test'
import assert from 'node:assert/strict'
import { projectWorkCard } from './projectWorkCard.js'
const row=(id,status='in_progress')=>({id,organization_id:'org',project_id:'project',engagement_id:'engagement',title:id,status,owner:{id:'owner',name:'Ava'}})
const workspace=()=>({project:{id:'project',organization_id:'org'},engagement:{id:'engagement'},projectTasks:[row('same'),row('task-input','todo')],engagementWorkItems:[row('same'),row('work-input','done')],taskDependencies:[{organization_id:'org',project_id:'project',task_id:'same',depends_on_task_id:'task-input'}],workItemDependencies:[{organization_id:'org',work_item_id:'same',depends_on_work_item_id:'work-input'}]})
test('same IDs keep Project Task and Engagement Work Item dependencies and status meanings separate',()=>{
 const w=workspace(),task=projectWorkCard(w,'project_task','same','/sphere/design'),work=projectWorkCard(w,'engagement_work_item','same','/sphere/design')
 assert.deepEqual(task.dependencies.map(row=>row.id),['task-input']);assert.equal(task.next.label,'Review dependency');assert.equal(task.next.path,'/sphere/workspace/items/project_task/task-input')
 assert.deepEqual(work.dependencies.map(row=>row.id),['work-input']);assert.equal(work.next.label,'Continue in Workshop');assert.equal(work.next.path,'/sphere/design');assert.equal(w.projectTasks[0].status,'in_progress')
})
test('unavailable prerequisites fail closed and foreign records cannot supply card details',()=>{
 const w=workspace();w.dependencyGaps={project_task:{same:1}};assert.equal(projectWorkCard(w,'project_task','same').next.label,'Review dependencies')
 w.projectTasks.push({...row('foreign'),project_id:'foreign'});assert.equal(projectWorkCard(w,'project_task','foreign'),null)
 w.engagementWorkItems.push({...row('foreign'),engagement_id:'foreign'});assert.equal(projectWorkCard(w,'engagement_work_item','foreign'),null)
 assert.equal(projectWorkCard(w,'task','same'),null)
})
test('cancelled prerequisite is not promoted to Done; closed work stays view-only',()=>{
 const w=workspace();w.projectTasks[1].status='cancelled';assert.equal(projectWorkCard(w,'project_task','same').next.label,'Review dependency')
 w.projectTasks[0].status='cancelled';assert.equal(projectWorkCard(w,'project_task','same').next.label,'View saved work')
 w.engagementWorkItems[0].status='done';assert.equal(projectWorkCard(w,'engagement_work_item','same').next.label,'View saved work')
})
test('one action guides owner and blocker review or exact work fallback without mutation',()=>{
 const w=workspace();w.taskDependencies=[];w.projectTasks[0].owner={id:null,name:'Unassigned'};assert.equal(projectWorkCard(w,'project_task','same').next.label,'Review owner')
 w.projectTasks[0].owner={id:'owner',name:'Ava'};w.projectTasks[0].status='blocked';assert.equal(projectWorkCard(w,'project_task','same').next.label,'Review blocker')
 w.projectTasks[0].status='in_progress';assert.equal(projectWorkCard(w,'project_task','same').next.label,'Open work record')
 assert.equal(w.projectTasks[0].status,'in_progress')
})
