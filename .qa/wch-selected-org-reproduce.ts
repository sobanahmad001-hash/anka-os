import { requireDepartmentEngagement } from '../supabase/functions/department-chat/index.ts'
const queries: unknown[] = []
const admin = { from(table: string) {
  const filters: Record<string, unknown> = {}
  const query: any = { select: () => query, eq: (key: string, value: unknown) => { filters[key] = value; return query },
    maybeSingle: async () => {
      queries.push({ table, filters })
      return { data: filters.organization_id === 'org-b' ? { id: 'engagement-b', organization_id: 'org-b' } : null }
    } }
  return query
} }
try { await (requireDepartmentEngagement as any)(admin, 'engagement-b', 'development', 'org-b') }
catch (error) { console.log((error as Error).message) }
console.log(JSON.stringify(queries))
if (!(queries as any[]).some(q => q.filters.organization_id === '8a6d2c5e-2c99-4ec7-a92f-6d1bd877eb25')) throw new Error('Fixed organization was not reproduced')
console.log('REPRODUCED: supplied B selection ignored; B engagement lookup constrained to fixed A. Synthetic query only; no provider or live database.')
