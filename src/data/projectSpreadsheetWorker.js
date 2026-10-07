import { unpackImportXlsx } from './projectSpreadsheetSource.js'
self.onmessage = event => {
  try { self.postMessage({ archive: unpackImportXlsx(new Uint8Array(event.data)) }) }
  catch (error) { self.postMessage({ error: error.message || 'Workbook inspection failed' }) }
}
