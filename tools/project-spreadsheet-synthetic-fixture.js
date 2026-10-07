import { zipSync, strToU8 } from 'fflate'
export function syntheticImportWorkbook() {
 const cell=(column,row,text)=>`<c r="${column}${row}" t="inlineStr"><is><t>${text}</t></is></c>`
 const headers=['page_key','title','planned_path','page_type','purpose','historical_status']
 const values=['synthetic:one','Synthetic service','/synthetic-service','service','Synthetic browser QA','published']
 const row=(n,values)=>`<row r="${n}">${values.map((v,i)=>cell(String.fromCharCode(65+i),n,v)).join('')}</row>`
 const files={
  'xl/workbook.xml':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Pages" sheetId="1" r:id="r1"/><sheet name="Hidden" state="hidden" sheetId="2" r:id="r2"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Target="worksheets/sheet1.xml"/><Relationship Id="r2" Target="worksheets/sheet2.xml"/></Relationships>',
  'xl/worksheets/sheet1.xml':`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${row(1,headers)}${row(2,values)}</sheetData></worksheet>`,
 }
 return zipSync(Object.fromEntries(Object.entries(files).map(([k,v])=>[k,strToU8(v)])))
}
