import {supabase} from '../lib/supabase.js'
import {createProjectStoredReportingRepository} from './projectStoredReportingRepository.js'
export const projectStoredReporting=createProjectStoredReportingRepository(supabase)
