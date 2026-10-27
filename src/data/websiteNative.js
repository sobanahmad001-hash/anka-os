import {supabase} from '../lib/supabase.js'
import {createWebsiteNativeRepository} from './websiteNativeRepository.js'
export const websiteNative=createWebsiteNativeRepository(supabase)
