// W3 fixed-task compiler: no process, shell, network, user PHP/JS or archive input.
import {compileWebsiteNativeDesign,websiteNativeSnapshotChecksum,validateWebsiteNavigationDestination} from './websiteNativeDesign.js'
export const WEBSITE_BLOCK_COMPILER='anka-native-block-v1'
export const WEBSITE_BLOCK_RUNTIME=Object.freeze({wordpress:'7.1.3',php:'8.3',network:false,arbitrary_code:false,maximum_files:10,maximum_bytes:1048576})
export const WEBSITE_BLOCK_FUNCTIONS=String.raw`<?php
// Fixed Anka runtime adapter. All page data lives in escaped WordPress content/meta.
if ( ! defined( 'ABSPATH' ) ) { exit; }
add_action( 'after_setup_theme', static function () { add_theme_support( 'title-tag' ); } );
add_action( 'wp_enqueue_scripts', static function () {
 wp_enqueue_style( 'anka-native-block', get_stylesheet_uri(), array(), '1.0.0' );
} );
add_action( 'wp_head', static function () {
 if ( is_singular( 'page' ) ) {
  $description = get_post_meta( get_queried_object_id(), '_anka_meta_description', true );
  if ( is_string( $description ) && $description !== '' ) {
   echo '<meta name="description" content="' . esc_attr( $description ) . '">' . "\n";
  }
 }
}, 1 );
`
const files=['anka-page.json','functions.php','parts/footer.html','parts/header.html','source-manifest.json','style.css','templates/index.html','theme.json']
export function assertWebsiteBlockFiles(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Fixed native file manifest required')
 const names=Object.keys(input),templates=names.filter(n=>/^templates\/anka-(home|service|location|article|about|contact)\.html$/.test(n))
 if(names.length!==9||templates.length!==1||files.some(n=>!Object.hasOwn(input,n)))throw Error('Only fixed native theme paths are accepted')
 let total=0
 for(const name of names){
  if(![...files,...templates].includes(name)||name.includes('\\')||name.includes('..')||name.startsWith('/')||typeof input[name]!=='string'||/\u0000/.test(input[name]))throw Error('Unsafe archive path or file')
  total+=new TextEncoder().encode(input[name]).byteLength
 }
 if(total>WEBSITE_BLOCK_RUNTIME.maximum_bytes)throw Error('Native package output exceeds bound')
 if(input['functions.php']!==WEBSITE_BLOCK_FUNCTIONS)throw Error('Only the fixed Anka runtime adapter is executable')
 for(const name of names.filter(n=>n.endsWith('.html')))if(/<\?(?:php|=)|<script\b|<iframe\b|<form\b|\bon[a-z]+\s*=|\bsrc\s*=\s*["'](?:https?:|\/\/|javascript:|data:)/i.test(input[name]))throw Error('Unsupported code or remote asset in block markup')
 for(const name of names.filter(n=>n.endsWith('.html')))for(const tag of input[name].matchAll(/<([a-z][a-z0-9-]*)\b[^>]*>/gi))for(const attr of tag[0].matchAll(/\b(href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)){
  if(attr[1].toLowerCase()!=='href'||tag[1].toLowerCase()!=='a')throw Error('Navigation href is supported only on anchor elements')
  validateWebsiteNavigationDestination((attr[2]??attr[3]??attr[4]).replaceAll('&amp;','&'))
 }
 if(/@import|url\s*\(|expression\s*\(|<\?/i.test(input['style.css']))throw Error('Unsupported stylesheet resource')
 return {files:names.length,bytes:total,paths:[...names].sort()}
}
export async function buildWebsiteBlockSource(manifest){
 const compiled=await compileWebsiteNativeDesign(manifest),directory='anka-native-'+compiled.input_checksum.slice(0,16),path=manifest.scope.page_key
 const theme=JSON.parse(compiled.files['theme.json'])
 theme.$schema='https://schemas.wp.org/wp/6.6/theme.json'
 const source={schema_version:1,compiler:WEBSITE_BLOCK_COMPILER,runtime:WEBSITE_BLOCK_RUNTIME,input_checksum:compiled.input_checksum,scope:compiled.scope,sources:compiled.sources,snapshot_checksums:compiled.snapshot_checksums,delivery_approved:false,staging:false,published:false}
 const page={schema_version:1,page_id:manifest.scope.page_id,page_key:path,title:manifest.content.title,meta_description:manifest.content.summary,post_content:compiled.blocks,template:'anka-'+manifest.layout.template}
 const output={...compiled.files,'theme.json':JSON.stringify(theme,null,2),'style.css':compiled.files['style.css'].replace('Anka Native Foundation','Anka Native Block Theme').replace('Version: 0.1.0','Version: 1.0.0'),'functions.php':WEBSITE_BLOCK_FUNCTIONS,'anka-page.json':JSON.stringify(page,null,2),'source-manifest.json':JSON.stringify(source,null,2)}
 const validation=assertWebsiteBlockFiles(output)
 const hashes={}
 for(const name of validation.paths)hashes[name]=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(output[name])))].map(x=>x.toString(16).padStart(2,'0')).join('')
 return {compiler:WEBSITE_BLOCK_COMPILER,directory,filename:directory+'.zip',scope:compiled.scope,sources:compiled.sources,input_checksum:compiled.input_checksum,files:output,files_checksum:await websiteNativeSnapshotChecksum(output),file_hashes:hashes,validation,source,page,runtime:WEBSITE_BLOCK_RUNTIME,delivery_approved:false,staging:false,published:false}
}
