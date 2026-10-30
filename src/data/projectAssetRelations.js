import {supabase} from '../lib/supabase.js'
import {createProjectAssetRelationsRepository} from './projectAssetRelationsRepository.js'
export const projectAssetRelations=createProjectAssetRelationsRepository(supabase)
