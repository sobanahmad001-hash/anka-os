import {IMPORT_LIMITS,parseImportCsv,parseImportXlsx} from './projectSpreadsheetSource.js'
import {spreadsheetSourceIdentity} from './projectSpreadsheetPreview.js'
export async function readProjectAttachmentSheet(file,{signal}={}){
 if(!file||file.size<1||file.size>IMPORT_LIMITS.bytes||!/\.(csv|xlsx)$/i.test(file.name))throw Error('Choose CSV or XLSX up to 2 MiB; XLS/XLSM are unsupported')
 if(file.name.length>200||/[\u0000-\u001f]/.test(file.name))throw Error('Choose a source filename up to 200 characters without control characters')
 const bytes=new Uint8Array(await file.arrayBuffer());if(signal?.aborted)throw Error('Attachment reading cancelled')
 const workbook=/\.csv$/i.test(file.name)?parseImportCsv(bytes):parseImportXlsx(bytes,globalThis.DOMParser,await new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./projectSpreadsheetWorker.js',import.meta.url),{type:'module'})
  const finish=()=>{clearTimeout(timer);worker.terminate();signal?.removeEventListener('abort',abort)}
  const abort=()=>{finish();reject(Error('Attachment reading cancelled'))}
  const timer=setTimeout(()=>{finish();reject(Error('Workbook inspection timed out; choose a smaller source'))},3000)
  worker.onmessage=event=>{finish();event.data.error?reject(Error(event.data.error)):resolve(event.data.archive)}
  worker.onerror=()=>{finish();reject(Error('Workbook inspection failed'))};signal?.addEventListener('abort',abort,{once:true});worker.postMessage(bytes.buffer.slice(0))
 }))
 const sha256=await spreadsheetSourceIdentity(bytes);if(signal?.aborted)throw Error('Attachment reading cancelled')
 const index=workbook.sheets.findIndex(sheet=>!sheet.hidden&&sheet.rows.length);if(index<0)throw Error('No visible nonempty sheet found')
 return {workbook,index,source:{name:file.name,sha256}}
}
