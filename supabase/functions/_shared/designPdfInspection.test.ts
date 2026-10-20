import { strict as assert } from 'node:assert'
import { Buffer } from 'node:buffer'
import { inspectDesignPdf } from './designPdfInspection.mjs'
function pdf(body='Hello Design reference',pages=1){
 const objects=['<< /Type /Catalog /Pages 2 0 R >>',`<< /Type /Pages /Kids [${Array.from({length:pages},(_,i)=>`${3+i*2} 0 R`).join(' ')}] /Count ${pages} >>`]
 for(let i=0;i<pages;i++){
  const stream=`BT /F1 0.1 Tf 40 60 Td (${body}) Tj ET`
  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /Contents ${4+i*2} 0 R >>`,`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`)
 }
 let result='%PDF-1.7\n',offsets=[0]
 objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(result));result+=`${i+1} 0 obj\n${o}\nendobj\n`})
 const xref=Buffer.byteLength(result)
 result+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
 return new Uint8Array(Buffer.from(result))
}
Deno.test('Design PDF extracts exact text and rejects page/text/no-text/malformed inputs without truncation', async()=>{
 const result=await inspectDesignPdf(pdf())
 assert.match(result.extractedText,/Hello Design reference/)
 await assert.rejects(inspectDesignPdf(pdf('Too many pages',21)),/1–20/)
 await assert.rejects(inspectDesignPdf(pdf('')),/no supported readable text/)
 await assert.rejects(inspectDesignPdf(pdf('x'.repeat(1000),20)),/16,000/)
 await assert.rejects(inspectDesignPdf(new TextEncoder().encode('%PDF-1.7\nbroken')),/malformed/)
})