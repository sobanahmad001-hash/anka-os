import {supabase} from '../lib/supabase.js'
import {createProjectWebsiteSiteFindingsRepository} from './projectWebsiteSiteFindingsRepository.js'
export const projectWebsiteSiteFindings=createProjectWebsiteSiteFindingsRepository(supabase)
