import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://fhoxaogfjszftoqtnbav.supabase.co';
const supabaseKey = 'sb_publishable_dmJ41ogtRJ-s_yirRbnsqg_5iotmTnE';

export const supabase = createClient(supabaseUrl, supabaseKey);
