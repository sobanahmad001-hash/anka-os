import {supabase} from '../lib/supabase.js'
import {createProjectWebsiteVersionChecksRepository} from './projectWebsiteVersionChecksRepository.js'
export const projectWebsiteVersionChecks=createProjectWebsiteVersionChecksRepository(supabase)
