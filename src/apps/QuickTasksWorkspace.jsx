import QuickTasks from './QuickTasks.jsx'
import { useOrganization } from '../context/OrganizationContext.jsx'

export default function QuickTasksWorkspace() {
  const { activeOrganizationId } = useOrganization()
  return <QuickTasks organizationId={activeOrganizationId} />
}
