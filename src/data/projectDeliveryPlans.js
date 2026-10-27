import {supabase} from '../lib/supabase.js'
import {createProjectDeliveryPlanRepository} from './projectDeliveryPlanRepository.js'
export const projectDeliveryPlans=createProjectDeliveryPlanRepository(supabase)
