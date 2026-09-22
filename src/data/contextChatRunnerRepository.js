import { supabase } from '../lib/supabase.js'
import { createContextChatRunnerRepository } from './contextChatRunnerTransport.js'

export const contextChatRunner = createContextChatRunnerRepository(supabase)
