import {supabase} from '../lib/supabase.js'
import {createWebsiteBlockRepository} from './websiteBlockRepository.js'
export const websiteBlocks=createWebsiteBlockRepository(supabase)
