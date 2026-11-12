import {Buffer} from 'node:buffer'
import {HTTPParser} from 'npm:http-parser-js@0.5.10'
import {isIP} from 'node:net'
import {stagingOrigin} from '../_shared/websiteStagingContracts.js'

export function siteOrigin(input:string) {
  const raw=input.trim()
  return stagingOrigin(raw.includes('://')?raw:'https://'+raw)
}
// Dial only a validated IPv4 address. TLS still authenticates the original site name.
export function publicAddress(ip:string) {
  if(isIP(ip)!==4)return false
  const [a,b,c]=ip.split('.').map(Number)
  return a>0&&a<224&&a!==10&&a!==127&&!(a===100&&b>=64&&b<=127)&&!(a===169&&b===254)
    &&!(a===172&&b>=16&&b<=31)&&!(a===192&&(b===168||b===0||b===2||(b===88&&c===99)))
    &&!(a===198&&(b===18||b===19||(b===51&&c===100)))&&!(a===203&&b===0&&c===113)
}
export type Reply={status:number,text:string,type:string,location:string}
export async function pinSite(host:string) {
  const addresses=await Deno.resolveDns(host,'A')
  if(!addresses.length||addresses.some(ip=>!publicAddress(ip)))throw Error('A public IPv4 HTTPS site is required.')
  return addresses[0]
}
async function readResponse(socket:Deno.TlsConn):Promise<Reply> {
  const parser = new HTTPParser('RESPONSE')
  parser.maxHeaderSize = 16384
  const chunks:Buffer[] = []
  let size = 0, wireSize = 0, complete = false
  let status = 0, type = '', location = ''
  parser[HTTPParser.kOnHeadersComplete] = info => {
    if (status || info.upgrade || info.statusCode < 200) throw Error('Unexpected response')
    status = info.statusCode
    for (let i = 0; i < info.headers.length; i += 2) {
      const name = info.headers[i].toLowerCase()
      if (name === 'location') location = info.headers[i + 1]
      if (name === 'content-type') type = info.headers[i + 1]
    }
  }
  parser[HTTPParser.kOnBody] = (chunk, offset, length) => {
    size += length
    if (size > 384000) throw Error('Public response exceeded limit')
    chunks.push(Buffer.from(chunk.subarray(offset, offset + length)))
  }
  parser[HTTPParser.kOnMessageComplete] = () => { complete = true }
  let headerPrefix = Buffer.alloc(0)
  const buffer = Buffer.alloc(8192)
  while (!complete) {
    const length = await socket.read(buffer)
    if (length === null) {
      if (parser.finish() instanceof Error || !complete) throw Error('Incomplete public response')
      break
    }
    wireSize += length
    if (wireSize > 448000) throw Error('Public response exceeded limit')
    const part = buffer.subarray(0, length)
    if (!status) {
      headerPrefix = Buffer.concat([headerPrefix, part])
      const end = headerPrefix.indexOf('\r\n\r\n')
      if ((end < 0 ? headerPrefix.length : end + 4) > 16384) throw Error('Public headers exceeded limit')
    }
    const used = parser.execute(part)
    if (used !== length) throw Error('Invalid public response')
  }
  return {status, type, location, text:Buffer.concat(chunks, size).toString('utf8')}
}

export async function readPinned(url:URL, ip:string, timeout:number):Promise<Reply> {
  if (!publicAddress(ip) || siteOrigin(url.origin) !== url.origin) throw Error('Public site unavailable.')
  let socket:Deno.Conn | undefined
  let expired = false
  let timer:ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true
      reject(Error('Public page timed out'))
    }, timeout)
  })
  async function read() {
    const tcp = await Deno.connect({hostname:ip, port:443})
    if (expired) { tcp.close(); throw Error('Public page timed out') }
    socket = tcp
    // Upgrade the validated connection in place. SNI and certificate verification use the site's DNS name.
    const tls = await Deno.startTls(tcp, {hostname:url.hostname})
    if (expired) { tls.close(); throw Error('Public page timed out') }
    socket = tls
    const request = new TextEncoder().encode([
      'GET ' + url.pathname + url.search + ' HTTP/1.1', 'Host: ' + url.hostname,
      'User-Agent: AnkaWebsiteInventory/1.0', 'Accept-Encoding: identity',
      'Accept: text/html,application/xml,text/xml,application/json,text/plain', 'Connection: close', '', ''
    ].join('\r\n'))
    for (let offset = 0; offset < request.length;) offset += await tls.write(request.subarray(offset))
    return await readResponse(tls)
  }
  try { return await Promise.race([read(), deadline]) }
  finally {
    clearTimeout(timer)
    try { socket?.close() } catch { /* TLS takes ownership of the TCP resource. */ }
  }
}
