import {SERVICE_BUSINESS_GROUP_MAPPINGS, serviceBusinessCatalogue} from './serviceBusinessGroups.js'
import {SERVICE_CADENCES, SERVICE_CATALOGUE_VERSION} from './serviceCatalogue.js'

// Proposed service-line intent. This never enables a scheduler, activates a service,
// creates a recurring plan or changes execution/review permission.
// target_date retains its canonical target/deadline meaning, not a recurrence end.
const groups = new Map(SERVICE_BUSINESS_GROUP_MAPPINGS.map(row => [row.service_id, row.groups]))
const recurring = new Set(['weekly','monthly','quarterly'])
const fields = ['catalogue_version','service_group','start_date','target_date','timezone','generation_horizon','scope_statement','exclusions']
const date = value => {
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) throw Error('Use an explicit ISO service date')
  const parsed = new Date(value+'T00:00:00Z')
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0,10) !== value) throw Error('Use a valid calendar service date')
  return value
}

export function validateServiceLineMetadata(value, leaf, cadence) {
  if (!SERVICE_CADENCES.includes(cadence)) throw Error('Review a supported service cadence')
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length || Object.keys(value).some(key => !fields.includes(key))) throw Error('Review complete service-line scope, dates and timezone')
  if (value.catalogue_version !== SERVICE_CATALOGUE_VERSION || !groups.get(leaf?.id)?.includes(value.service_group)) throw Error('Choose a reviewed business scope for this exact catalogue service')
  serviceBusinessCatalogue({leaves:[leaf]})
  const start = date(value.start_date), target = value.target_date === null ? null : date(value.target_date)
  if (target && target < start) throw Error('The service target date precedes its start date')
  if (typeof value.timezone !== 'string' || value.timezone.length > 100 || !/^[A-Za-z][A-Za-z0-9_+./-]*$/.test(value.timezone)) throw Error('Choose an explicit IANA project timezone')
  try { new Intl.DateTimeFormat('en',{timeZone:value.timezone}).format(0) } catch { throw Error('Choose a valid IANA project timezone') }
  if (recurring.has(cadence) ? !Number.isInteger(value.generation_horizon) || value.generation_horizon < 1 || value.generation_horizon > 12 : value.generation_horizon !== null) throw Error('Review a finite recurring-cycle horizon; once and custom services have no automatic cycle horizon')
  if (typeof value.scope_statement !== 'string' || !value.scope_statement.trim() || value.scope_statement.length > 4000 || typeof value.exclusions !== 'string' || value.exclusions.length > 4000) throw Error('Review the agreed scope and exclusions')
  return {...value, start_date:start, target_date:target, scope_statement:value.scope_statement.trim(), exclusions:value.exclusions.trim()}
}
