import { supabase } from '../lib/supabase.js'
import { createOperatingSpineRepository } from './operatingSpineRepository.js'

export const operatingSpine = createOperatingSpineRepository(supabase)
