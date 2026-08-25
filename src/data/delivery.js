import { supabase } from '../lib/supabase.js'
import { createDeliveryRepository } from './deliveryRepository.js'

export const delivery = createDeliveryRepository(supabase)
