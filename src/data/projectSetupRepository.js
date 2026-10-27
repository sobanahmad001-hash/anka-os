import {supabase} from '../lib/supabase.js'
import {validateProjectSetup} from './projectSetup.js'
import {createProjectDeliverySetupRepository} from './projectDeliverySetupRepository.js'
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x)
export function createProjectSetupRepository(client= supabase){
 async function call(name,args,signal){let q=client.rpc(name,args);if(signal&&q.abortSignal)q=q.abortSignal(signal);const {data,error}=await q;if(error)throw Object.assign(Error(error.message),{status:error.code==='42501'?403:error.code==='40001'?409:undefined});return data}
 return {
  delivery:createProjectDeliverySetupRepository(client),
  async snapshot(organizationId,projectId,signal){if(!uuid(organizationId)||!uuid(projectId))throw Error('Exact project required');const d=await call('get_project_setup',{p_organization_id:organizationId,p_project_id:projectId},signal);if(d?.organization_id!==organizationId||d.project_id!==projectId||!/^[0-9a-f]{32}$/.test(d.token)||!Array.isArray(d.leaves)||!Array.isArray(d.scopes))throw Error('Project setup context changed');return d},
  async recover(organizationId,projectId,requestId){if(![organizationId,projectId,requestId].every(uuid))throw Error('Exact original setup request required');return call('recover_project_setup',{p_organization_id:organizationId,p_project_id:projectId,p_request_id:requestId})},
  async apply(snapshot,proposal,requestId,acknowledgements){const validated=validateProjectSetup(proposal,snapshot);if(!validated.ready||!uuid(requestId))throw Error('Resolve quantities and questions before Apply setup');const {ready:_ready,...plan}=validated;const d=await call('apply_project_setup',{p_organization_id:snapshot.organization_id,p_project_id:snapshot.project_id,p_request_id:requestId,p_expected_token:snapshot.token,p_plan:{...plan,legacy_acknowledgements:acknowledgements}});if(d?.organization_id!==snapshot.organization_id||d.project_id!==snapshot.project_id||d.request_id!==requestId||!Array.isArray(d.results))throw Error('Setup result identity changed; retry only the original command');return d}
 }
}
export const projectSetupRepository=createProjectSetupRepository()
