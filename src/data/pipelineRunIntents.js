import { supabase } from '../lib/supabase.js'
import { createPipelineRunIntentsRepository } from './pipelineRunIntentsRepository.js'

export const pipelineRunIntents = createPipelineRunIntentsRepository(supabase)
