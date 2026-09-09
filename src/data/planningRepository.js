import { supabase } from '../lib/supabase.js'
import { createPlanningRepository } from './planningRepositoryFactory.js'

export { createPlanningRepository } from './planningRepositoryFactory.js'

export const planningRepository = createPlanningRepository(supabase)
