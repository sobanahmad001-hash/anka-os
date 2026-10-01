import {supabase} from '../lib/supabase.js'
import {createProjectWebsiteSeoObservationsRepository} from './projectWebsiteSeoObservationsRepository.js'
import {projectReportingBindings} from './projectReportingBindings.js'
export const projectWebsiteSeoObservations=Object.freeze({list:createProjectWebsiteSeoObservationsRepository(supabase).list,bindings:projectReportingBindings.list})
