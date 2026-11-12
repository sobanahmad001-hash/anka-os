import test from 'node:test'
import assert from 'node:assert/strict'
import { SERVICE_CATALOGUE } from './serviceCatalogue.js'
import {deliveryServices,periodCards,periodEnd,serviceDefaults} from './marketingServiceDelivery.js'

test('every Marketing catalogue leaf has a specialist or manual delivery entry',()=>{
 const all=SERVICE_CATALOGUE.filter(x=>x.department_id==='marketing').map(service_catalog=>({status:'active',service_catalog}))
 const services=deliveryServices({services:all})
 assert.equal(all.length,39)
 assert.equal(services.length,37)
 for(const s of services){const d=serviceDefaults(s);assert.equal(d.unit,s.service_catalog.unit);assert.equal(d.cadence,s.service_catalog.recurrence)}
 assert.equal(deliveryServices({services:[{...services[0],status:'cancelled'}]}).length,0)
})
test('calendar periods handle weeks, leap months and year boundaries',()=>{
 assert.equal(periodEnd('2028-02-01','monthly'),'2028-02-29')
 assert.equal(periodEnd('2026-12-28','weekly'),'2027-01-03')
 assert.equal(periodEnd('2026-11-01','quarterly'),'2027-01-31')
})
test('carry-forward counts original and delivered quantities in their own periods and units',()=>{
 const original={id:'a',project_id:'p',service_id:'s',starts_on:'2026-09-01',ends_on:'2026-09-30'}
 const later={...original,id:'b',starts_on:'2026-10-01',ends_on:'2026-10-31'}
 const card={project_id:'p',service_id:'s',period_id:'a',planned_date:'2026-10-01',delivered_on:'2026-10-03',committed_units:3,delivered_units:2,marketing_service_periods:{unit:'articles'}}
 assert.equal(periodCards(original,[card]).committed,3)
 assert.equal(periodCards(original,[card]).actual.size,0)
 const report=periodCards(later,[card]);assert.equal(report.committed,0);assert.equal(report.actual.get('articles'),2);assert.equal(report.calendar.size,1)
 assert.throws(()=>periodCards(later,[{...card,service_id:'wrong'}]),/scope mismatch/)
})
