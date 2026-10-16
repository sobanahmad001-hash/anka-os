import { useMemo, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { useOrganization } from '../context/OrganizationContext'
import AuthorityCompatibilityAdmin from '../components/AuthorityCompatibilityAdmin'
import PeopleTeamControls from '../components/PeopleTeamControls'
import PeopleClientControls from '../components/PeopleClientControls'
import { createPeopleAccessReadRepository } from '../data/peopleAccessReadModel'
import { createPeopleManagementRepository, INVITATION_ORGANIZATION_ID } from '../data/peopleManagement'

export default function UserManagement(){
 const {user}=useAuth(),scope=useOrganization()
 const repository=useMemo(()=>createPeopleManagementRepository(supabase),[]),readRepository=useMemo(()=>createPeopleAccessReadRepository(supabase),[])
 const canTeam=['system_owner','operations_admin'].includes(scope.activeMembership?.role)
 const canClient=['system_owner','operations_admin','executive','project_owner'].includes(scope.activeMembership?.role)
 if(scope.loading)return <p className="p-6">Loading organization…</p>
 if(!scope.activeOrganizationId||(!canTeam&&!canClient))return <p className="p-6">People administration is unavailable with your current organization membership.</p>
 return <PeopleScope key={user?.id+':'+scope.activeOrganizationId+':'+scope.scopeRevision} {...{scope,user,repository,readRepository,canTeam,canClient}}/>
}
function PeopleScope({scope,user,repository,readRepository,canTeam,canClient}){
 const query=new URLSearchParams(globalThis.location?.search||'')
 const [view,setView]=useState(query.get('view')==='clients'||!canTeam?'clients':'team')
 const common={organizationId:scope.activeOrganizationId,organizationName:scope.activeOrganization?.name,requestSignal:scope.requestSignal}
 return <main className="workspace-page people-management"><style>{`.people-management input,.people-management select{display:block;width:100%;max-width:100%;padding:9px;border:1px solid var(--anka-line);border-radius:8px;background:var(--anka-surface);color:var(--anka-ink)}.people-management label{display:block;min-width:0}.people-management article{overflow-wrap:anywhere}.people-management button:disabled{opacity:.5}.people-management :focus-visible{outline:3px solid var(--anka-focus);outline-offset:2px}`}</style><div className="workspace-container"><header><h1 className="workspace-title">People & access</h1><p>{scope.activeOrganization?.name||'Selected organization'}</p><p>Manage organization membership, client invitations and recorded project relationships. Existing accounts and history are retained.</p></header><nav aria-label="People administration" className="my-5 flex flex-wrap gap-3">{canTeam&&<button className="workspace-button" aria-pressed={view==='team'} onClick={()=>setView('team')}>Team</button>}{canClient&&<button className="workspace-button" aria-pressed={view==='clients'} onClick={()=>setView('clients')}>Clients</button>}{canTeam&&<button className="workspace-button" aria-pressed={view==='relationships'} onClick={()=>setView('relationships')}>Departments & project relationships</button>}</nav>
 {view==='team'&&canTeam&&<PeopleTeamControls {...common} actorId={user.id} repository={repository} readRepository={readRepository}/>}
 {view==='clients'&&canClient&&<PeopleClientControls {...common} repository={repository} initialClient={query.get('client')||''} canInvite={scope.activeOrganizationId===INVITATION_ORGANIZATION_ID}/>}
 {view==='relationships'&&canTeam&&<AuthorityCompatibilityAdmin {...common}/>}
 <aside className="mt-6 workspace-card p-4"><h2>Invitation help</h2><p>Sign-in and invitation acceptance are not checked here. Administrative resend is not enabled. A person who already received an invitation can use the recovery page to request a new password link.</p><a href="/auth/recover" className="underline">Open account recovery</a></aside>
 </div></main>
}
