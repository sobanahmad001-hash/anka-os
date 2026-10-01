import {supabase} from '../lib/supabase.js'
import {createProjectCampaignPlanningLookupsRepository} from './projectCampaignPlanningLookupsRepository.js'
import {createProjectCampaignAssetsRepository} from './projectCampaignAssetsRepository.js'
import {createProjectCampaignPlacementsRepository} from './projectCampaignPlacementsRepository.js'
import {projectReportingBindings} from './projectReportingBindings.js'
export const projectCampaignPlanning=Object.freeze({lookup:createProjectCampaignPlanningLookupsRepository(supabase),assets:createProjectCampaignAssetsRepository(supabase),placements:createProjectCampaignPlacementsRepository(supabase),resources:projectReportingBindings})
