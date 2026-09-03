import { supabase } from '../lib/supabase.js'
import { createDepartmentChatRepository } from './departmentChatTransport.js'

export const departmentChat = createDepartmentChatRepository(supabase)
