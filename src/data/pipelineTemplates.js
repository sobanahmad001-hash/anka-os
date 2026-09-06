import { supabase } from '../lib/supabase.js'
import { createPipelineTemplatesRepository } from './pipelineTemplatesRepository.js'

export const pipelineTemplates = createPipelineTemplatesRepository(supabase)
