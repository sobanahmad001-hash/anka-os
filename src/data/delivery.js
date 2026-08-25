import { supabase } from '../lib/supabase.js'
import { recordClientApproval } from './clientApprovals.js'
import { createDeliveryRepository } from './deliveryRepository.js'

const repository = createDeliveryRepository(supabase)

export const delivery = Object.assign(repository, {
  recordClientApproval: (input, userId) => recordClientApproval(supabase, input, userId),
})
