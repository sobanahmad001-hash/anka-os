import { supabase } from '../lib/supabase.js'
import { createProjectPipelineConfigurationsRepository } from './projectPipelineConfigurationsRepository.js'

export const projectPipelineConfigurations = createProjectPipelineConfigurationsRepository(supabase)