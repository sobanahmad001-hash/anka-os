import { supabase } from '../lib/supabase.js'
import { createContextChatReleaseReviewTransport } from './contextChatReleaseReviewTransport.js'

export const contextChatReleaseReview = createContextChatReleaseReviewTransport(supabase)
