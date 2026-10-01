import {supabase} from '../lib/supabase.js'
import {createProjectWebsitePagesRepository} from './projectWebsitePagesRepository.js'
export const projectWebsitePages=createProjectWebsitePagesRepository(supabase)
