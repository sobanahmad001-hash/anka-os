// The serverless parser runs inside the Edge isolate's enforced CPU/memory
// ceiling. The cooperative deadline below is NOT a synchronous CPU watchdog.
// Enable PDF routes only after the target Edge resource-limit tests pass.
export const DESIGN_PDF_LIMITS = Object.freeze({ bytes: 5 * 1024 * 1024, pages: 20, characters: 16000, items: 32000, milliseconds: 3000 })
export const DESIGN_PDF_PARSER = 'unpdf@1.9.0'
const reject = message => Object.assign(new Error(message), { status: 422, code: 'DESIGN_PDF_REJECTED' })

export async function inspectDesignPdf(bytes, load = () => import('npm:unpdf@1.9.0')) {
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > DESIGN_PDF_LIMITS.bytes) throw reject('PDF exceeds the 5 MiB limit.')
  if (!new TextDecoder().decode(bytes.subarray(0, 8)).match(/^%PDF-[12]\.[0-9]/)) throw reject('PDF signature is invalid.')
  const { getResolvedPDFJS } = await load()
  const { getDocument } = await getResolvedPDFJS()
  // No URL/file access, font downloads, CMaps, WASM or rendering. Reject rather
  // than extracting incomplete text when the parser needs an external resource.
  let externalRequested = false
  class ClosedBinaryDataFactory {
    async fetch() { externalRequested = true; throw reject('PDF requires an unsupported external resource.') }
  }
  const started = performance.now()
  const check = () => {
    if (externalRequested) throw reject('PDF requires an unsupported external resource.')
    if (performance.now() - started > DESIGN_PDF_LIMITS.milliseconds) throw reject('PDF parsing exceeded the time limit.')
  }
  const task = getDocument({ data: bytes.slice(), verbosity: 0, stopAtErrors: true,
    isEvalSupported: false, useWorkerFetch: false, useWasm: false,
    disableFontFace: true, useSystemFonts: true, enableXfa: false,
    isOffscreenCanvasSupported: false, isImageDecoderSupported: false,
    disableRange: true, disableStream: true, disableAutoFetch: true,
    maxImageSize: 0, BinaryDataFactory: ClosedBinaryDataFactory,
    CMapReaderFactory: ClosedBinaryDataFactory, StandardFontDataFactory: ClosedBinaryDataFactory,
  })
  task.onPassword = () => { void task.destroy() }
  let doc
  try {
    doc = await task.promise; check()
    if (!Number.isInteger(doc.numPages) || doc.numPages < 1 || doc.numPages > DESIGN_PDF_LIMITS.pages) throw reject('PDF must contain 1–20 pages.')
    const metadata = await doc.getMetadata(); check()
    if (metadata?.info?.EncryptFilterName || metadata?.info?.IsXFAPresent || metadata?.info?.IsAcroFormPresent) throw reject('Encrypted PDFs and interactive forms are not supported.')
    if (await doc.getAttachments()) throw reject('PDFs with embedded files are not supported.')
    if (await doc.getJSActions()) throw reject('PDFs with executable actions are not supported.')
    if (await doc.getOpenAction()) throw reject('PDFs with opening actions are not supported.')
    let text = '', items = 0
    for (let number = 1; number <= doc.numPages; number++) {
      check()
      const page = await doc.getPage(number)
      try {
        if (await page.getJSActions()) throw reject('PDF page actions are not supported.')
        const annotations = await page.getAnnotations()
        if (annotations.some(a => a.url || a.unsafeUrl || a.actions || a.attachment || a.file || a.action || a.isOpen)) throw reject('PDF external links, files and interactive actions are not supported.')
        const content = await page.getTextContent({ includeMarkedContent: false })
        check()
        for (const item of content.items) {
          if (++items > DESIGN_PDF_LIMITS.items) throw reject('PDF text complexity exceeds the supported limit.')
          if (typeof item.str !== 'string') continue
          text += item.str + (item.hasEOL ? '\n' : ' ')
          if (text.length > DESIGN_PDF_LIMITS.characters) throw reject('PDF exceeds 16,000 extracted characters; nothing was truncated.')
        }
        text += '\n'
        if (text.length > DESIGN_PDF_LIMITS.characters) throw reject('PDF exceeds 16,000 extracted characters; nothing was truncated.')
      } finally { page.cleanup() }
    }
    check()
    text = text.trim()
    if (!text || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) throw reject('PDF has no supported readable text. Scans and OCR are not supported.')
    return { verifiedMime: 'application/pdf', extractionKind: 'pdf_text', extractedText: text,
      extractionNotice: 'PDF text only; layout, pictures and handwriting are not read. No OCR. Original retained.', pages: doc.numPages }
  } catch (error) {
    if (error?.code === 'DESIGN_PDF_REJECTED') throw error
    throw reject('PDF is malformed, encrypted or unsupported; no text was saved.')
  } finally { await task.destroy().catch(() => {}) }
}
