import { supabase } from '../lib/supabase.js'
import { createPipelineExecutionDefinitionsRepository } from './pipelineExecutionDefinitionsRepository.js'

export const pipelineExecutionDefinitions = createPipelineExecutionDefinitionsRepository(supabase)