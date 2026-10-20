import test from 'node:test'
import assert from 'node:assert/strict'
import { projectAttachmentRoute } from './projectAttachmentRouting.js'
test('spreadsheet and document formats route separately without external operations', () => {
 for (const name of ['plan.csv','plan.XLSX']) assert.equal(projectAttachmentRoute({name,size:123}), 'spreadsheet')
 for (const name of ['brief.pdf','brief.docx','brief.txt','brief.md']) assert.equal(projectAttachmentRoute({name,size:123}), 'document')
})
test('unsupported and oversized files never enter a supported route', () => {
 for (const name of ['legacy.doc','macro.xlsm','video.mp4','photo.png','a.pdf.exe']) assert.throws(()=>projectAttachmentRoute({name,size:123}))
 for (const [name,size] of [['a.csv',2097153],['a.docx',4194305],['a.pdf',5242881],['a.md',0]]) assert.throws(()=>projectAttachmentRoute({name,size}))
})
