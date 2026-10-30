import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {buildAssetPreview} from './asset-work-preview.mjs'
if(!process.argv.includes('--reuse-build'))await buildAssetPreview()
const base=new URL('../outputs/asset-work-preview/',import.meta.url),html=await readFile(new URL('tools/asset-work-preview.html',base),'utf8')
let output=html
for(const match of html.matchAll(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g)){const js=await readFile(new URL('.'+match[1],base),'utf8');output=output.replace(match[0],()=>'<script type="module">'+js.replaceAll('</script','<\\/script')+'</script>')}
for(const match of html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)){const css=await readFile(new URL('.'+match[1],base),'utf8');output=output.replace(match[0],()=>'<style>'+css+'</style>')}
output=output.replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src \'none\'; connect-src \'none\'; base-uri \'none\'; form-action \'none\'">')
if(/(?:src|href)="\/(?:assets|tools)\//.test(output))throw Error('Standalone preview still depends on external bundles')
const destination=new URL('../../../outputs/anka-asset-work-preview-20261030.html',import.meta.url);await mkdir(new URL('./',destination),{recursive:true});await writeFile(destination,output)
await writeFile(new URL('../outputs/asset-work-preview-export.json',import.meta.url),JSON.stringify({file:destination.pathname,sha256:createHash('sha256').update(output).digest('hex'),bytes:Buffer.byteLength(output),actualComponents:true,syntheticReadOnlyRepositories:true,canonicalSaves:false,productionWrites:0,providerCalls:0},null,2))
console.log('Standalone asset/work review preview exported')
