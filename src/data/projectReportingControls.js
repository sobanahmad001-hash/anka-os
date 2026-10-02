import {supabase} from '../lib/supabase.js'
import {createProjectReportingControlsRepository} from './projectReportingControlsRepository.js'
export const projectReportingControls=createProjectReportingControlsRepository(supabase)
