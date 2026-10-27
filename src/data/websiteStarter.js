import {supabase} from '../lib/supabase.js'
import {createWebsiteStarterRepository} from './websiteStarterRepository.js'
export const websiteStarter=createWebsiteStarterRepository(supabase)
