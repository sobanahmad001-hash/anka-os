import { supabase } from '../lib/supabase.js'
import { createWorkspaceHomeRepository } from './workspaceHomeRepositoryFactory.js'

export const workspaceHomeRepository = createWorkspaceHomeRepository(supabase)
