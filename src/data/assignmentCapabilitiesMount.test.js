import test from 'node:test'
import assert from 'node:assert/strict'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createServer } from 'vite'
import { mountedEnvironment } from './testSupport/n1bMountedDom.js'
const nodes = node => [node,...node.childNodes.flatMap(nodes)]

for (const [title, canAssign, capabilityVersion] of [['assigned contributor',false,1],['explicit PM',true,1],['stale capability',true,2]]) {
  test('mounted planning controls: ' + title, async t => {
    const environment=mountedEnvironment()
    const previous={ document:globalThis.document,window:globalThis.window,IS_REACT_ACT_ENVIRONMENT:globalThis.IS_REACT_ACT_ENVIRONMENT }
    Object.assign(globalThis,{document:environment.document,window:environment.window,IS_REACT_ACT_ENVIRONMENT:true})
    const server=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'silent',
      plugins:[{name:'n1c-planning-offline',enforce:'pre',
        resolveId(source) {
          if(source.endsWith('useAssignmentCapabilities.js')) return '/n1c-capabilities'
          if(source.endsWith('planningRepository.js')) return '/n1c-planning'
        },
        load(id) {
          if(id==='/n1c-capabilities') return 'export const useAssignmentCapabilities = () => globalThis.__n1cCapabilities'
          if(id==='/n1c-planning') return 'export const planningRepository = {}'
        },
      }]})
    globalThis.__n1cCapabilities={data:{
      project_tasks:[{id:'task',row_version:capabilityVersion,can_assign:canAssign,can_execute:true}],
      engagement_work_items:[{id:'item',row_version:capabilityVersion,can_assign:canAssign,can_execute:true}],
    },error:''}
    const {default:Panel}=await server.ssrLoadModule('/src/components/ProjectPlanningPanel.jsx')
    const root=createRoot(environment.container)
    t.after(async()=>{await act(async()=>root.unmount());await server.close();Object.assign(globalThis,previous);delete globalThis.__n1cCapabilities})
    const workspace={context:{client:null},project:{id:'project'},projectTasks:[{id:'task',row_version:1,status:'backlog',title:'Task',assigned_to:'bob'}],
      engagementWorkItems:[{id:'item',row_version:1,status:'not_started',title:'Item',assignee_id:'bob',department_id:'design'}],
      workstreams:[{department_id:'design'}],teamMembers:[{id:'bob',name:'Bob'}]}
    await act(async()=>root.render(createElement(Panel,{workspace,organizationId:'org',membership:{role:'contributor'},onRefresh:async()=>{}})))
    const assignmentLabels=nodes(environment.container).filter(node=>node.tagName==='LABEL' && node.textContent.startsWith('Assignee'))
    assert.equal(assignmentLabels.length,2)
    for(const label of assignmentLabels) assert.equal(nodes(label).find(node=>node.tagName==='SELECT').disabled,!canAssign || capabilityVersion!==1)
    const saves=nodes(environment.container).filter(node=>node.tagName==='BUTTON' && /^Save (Project Task|Work Item)$/.test(node.textContent))
    assert.equal(saves.length,2)
    for(const save of saves) assert.equal(save.disabled,capabilityVersion!==1)
    assert.match(environment.container.textContent,/Execution does not grant approval or release/)
  })
}
