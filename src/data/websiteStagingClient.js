import {supabase} from '../lib/supabase.js'
import {createWebsiteStagingRepository} from './websiteStagingRepository.js'
export const websiteStaging=createWebsiteStagingRepository(supabase)
