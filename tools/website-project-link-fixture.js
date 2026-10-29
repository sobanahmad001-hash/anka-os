import {id,organizationId,projectId,engagementId} from './website-block-fixture.js'
export function attachProjectLinkFixture(staging,actor){
 const choice={id:id(52),display_name:'Anka Sphere synthetic Hostinger staging',base_url:'https://staging.example.test',revision:'2026-10-29T11:00:00Z'},state={linked:false,save:0,recover:0,lost:true,receipt:null},workspace=staging.repository.workspace
 staging.repository.workspace=async(...args)=>({...await workspace(...args),connections:state.linked?[choice]:[]})
 staging.repository.linkWorkspace=async()=>({organization_id:organizationId,project_id:projectId,engagement_id:engagementId,connections:[{...choice,project_linked:state.linked}]})
 staging.repository.linkSave=async(_scope,input)=>{state.save++;state.linked=true;state.receipt={organization_id:organizationId,project_id:projectId,engagement_id:engagementId,connection_id:choice.id,base_url:choice.base_url,request_id:input.requestId,created_by:actor,department_id:'development'};if(state.lost){state.lost=false;throw Error('Synthetic committed link response lost')}return structuredClone(state.receipt)}
 staging.repository.linkRecover=async(_scope,requestId)=>{state.recover++;if(requestId!==state.receipt?.request_id)throw Error('Wrong original fixture request');return structuredClone(state.receipt)}
 return state
}
