import {supabase} from '../lib/supabase.js'
import {createProjectPageKeywordTargetsRepository} from './projectPageKeywordTargetsRepository.js'
export const projectPageKeywordTargets=createProjectPageKeywordTargetsRepository(supabase)
