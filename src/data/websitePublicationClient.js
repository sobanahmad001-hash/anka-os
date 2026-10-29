import {supabase} from '../lib/supabase.js'
import {createWebsitePublicationRepository} from './websitePublicationRepository.js'
export const websitePublication=createWebsitePublicationRepository(supabase)
