import { collectDirectoryPages } from './workspaceDirectoryPagination.js'
export const INVITATION_ORGANIZATION_ID = '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25'
export const TEAM_ROLES = ['operations_admin','executive','department_manager','project_owner','contributor']
export const TEAM_DEPARTMENTS = ['content','design','marketing','development']
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || '')
const check = signal => signal?.throwIfAborted()
export function createPeopleManagementRepository(client) {
  async function rows(table,columns,org,configure,signal) {
    if (!uuid(org)) throw Error('Exact organization required')
    return collectDirectoryPages((from,to) => {
      let query=client.from(table).select(columns).eq('organization_id',org)
      if(configure) query=configure(query)
      return query.order('id').range(from,to).abortSignal(signal)
    },{name:'People '+table,signal,validate:row=>row.organization_id===org})
  }
  return {
    async team(org,{signal}={}) {
      const members=await rows('organization_memberships','id,organization_id,user_id,role,department_id,status,member_kind,updated_at',org,q=>q.eq('member_kind','team'),signal)
      const ids=members.map(row=>row.user_id)
      const profiles=ids.length ? await collectDirectoryPages((from,to)=>client.from('profiles').select('id,full_name,role,department').in('id',ids).order('id').range(from,to).abortSignal(signal),{name:'People profiles',signal,validate:row=>ids.includes(row.id)}) : []
      return members.map(row=>({...row,name:profiles.find(p=>p.id===row.user_id)?.full_name || 'Unnamed member'}))
    },
    async update(org,member,role,department,requestId,{signal}={}) {
      check(signal)
      if(!uuid(org)||!uuid(member.user_id)||member.organization_id!==org||!uuid(requestId)||!member.updated_at||!TEAM_ROLES.includes(role)||!department) throw Error('Complete membership change required')
      const {data,error}=await client.rpc('update_team_membership',{p_organization_id:org,p_user_id:member.user_id,p_expected_revision:member.updated_at,p_role:role,p_department_id:department,p_request_id:requestId})
      check(signal);if(error) throw error
      if(data?.organization_id!==org||data?.user_id!==member.user_id||data?.request_id!==requestId||data.global_profile_changed!==false||data.role!==role||data.department_id!==department) throw Error('Membership result could not be confirmed')
      return data
    },
    async invite(org,input,{signal}={}) {
      check(signal);if(org!==INVITATION_ORGANIZATION_ID) throw Error('Team invitations are currently available for Anka only')
      const {data,error}=await client.functions.invoke('invite-user',{body:{...input,organization_id:org,action:'invite'}})
      check(signal);if(error||data?.success!==true) throw Error(data?.error || 'Invitation outcome unknown. Review account state before another invitation.')
      return data
    },
    clients(org,{signal}={}) {return rows('clients','id,organization_id,name,company,status',org,null,signal)},
    async client(org,id,{signal}={}) {
      if(!uuid(id)) throw Error('Exact client required')
      const [contacts,projects]=await Promise.all([
        rows('client_contacts','id,organization_id,client_id,full_name,email,portal_role,status',org,q=>q.eq('client_id',id),signal),
        rows('projects','id,organization_id,client_id,name,status,archived_at',org,q=>q.eq('client_id',id),signal),
      ])
      if(contacts.some(x=>x.client_id!==id)||projects.some(x=>x.client_id!==id)) throw Error('Client scope mismatch')
      const ids=contacts.map(x=>x.id)
      const grants=ids.length?await rows('project_client_access','id,organization_id,project_id,client_contact_id,access_role,status',org,q=>q.in('client_contact_id',ids),signal):[]
      if(grants.some(x=>!ids.includes(x.client_contact_id)))throw Error('Client grant scope mismatch')
      return {rows:contacts.map(c=>({...c,access:grants.filter(g=>g.client_contact_id===c.id).map(g=>({...g,projectName:projects.find(p=>p.id===g.project_id)?.name||'Project not in current client list'}))})),projects:projects.filter(p=>!p.archived_at)}
    },
  }
}
