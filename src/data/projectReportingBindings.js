import {supabase} from '../lib/supabase.js'
import {createProjectReportingBindingsRepository} from './projectReportingBindingsRepository.js'
export const projectReportingBindings=createProjectReportingBindingsRepository(supabase)
