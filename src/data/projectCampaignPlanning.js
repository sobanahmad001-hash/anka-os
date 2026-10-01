import {createProjectMarketingOpportunitiesRepository} from './projectMarketingOpportunitiesRepository.js'
import {createProjectCampaignPlanCommandsRepository} from './projectCampaignPlanCommandsRepository.js'
import {supabase} from '../lib/supabase.js'
import {createProjectCampaignPlanningLookupsRepository} from './projectCampaignPlanningLookupsRepository.js'
import {createProjectCampaignAssetsRepository} from './projectCampaignAssetsRepository.js'
import {createProjectCampaignPlacementsRepository} from './projectCampaignPlacementsRepository.js'
import {projectReportingBindings} from './projectReportingBindings.js'
export const projectCampaignPlanning=Object.freeze({opportunities:createProjectMarketingOpportunitiesRepository(supabase),plans:createProjectCampaignPlanCommandsRepository(supabase),lookup:createProjectCampaignPlanningLookupsRepository(supabase),assets:createProjectCampaignAssetsRepository(supabase),placements:createProjectCampaignPlacementsRepository(supabase),resources:projectReportingBindings})
