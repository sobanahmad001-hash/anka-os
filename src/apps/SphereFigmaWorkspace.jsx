import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'

export default function SphereFigmaWorkspace() {
  const { user } = useAuth()
  const [projects, setProjects] = useState([])
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [activeTab, setActiveTab] = useState('browser')

  // Figma config
  const [figmaToken, setFigmaToken] = useState('')
  const [figmaFiles, setFigmaFiles] = useState([]) // [{key, name, url}]
  const [configSaved, setConfigSaved] = useState(false)
  const [configDocId, setConfigDocId] = useState(null)
  const [addingFile, setAddingFile] = useState(false)
  const [newFileUrl, setNewFileUrl] = useState('')
  const [newFileName, setNewFileName] = useState('')

  // File browser
  const [selectedFile, setSelectedFile] = useState(null)
  const [fileData, setFileData] = useState(null)
  const [loadingFile, setLoadingFile] = useState(false)
  const [fileError, setFileError] = useState('')
  const [frames, setFrames] = useState([])
  const [selectedFrame, setSelectedFrame] = useState(null)
  const [frameImages, setFrameImages] = useState({}) // nodeId → imageUrl

  // Embed viewer
  const [embedUrl, setEmbedUrl] = useState('')

  // Actions
  const [extractingBrand, setExtractingBrand] = useState(false)
  const [exportingFrame, setExportingFrame] = useState(null)
  const [sendingToWP, setSendingToWP] = useState(null)
  const [wpPages, setWpPages] = useState([])
  const [wpSites, setWpSites] = useState([])
  const [actionFeedback, setActionFeedback] = useState('')

  useEffect(() => { fetchProjects() }, [])
  useEffect(() => {
    if (selectedProjectId) {
      fetchFigmaConfig()
      fetchWPData()
    }
  }, [selectedProjectId])

  async function fetchProjects() {
    const { data } = await supabase.from('as_projects')
      .select('id, name, as_clients(name)').order('name')
    setProjects(data || [])
  }

  async function fetchFigmaConfig() {
    const { data } = await supabase.from('as_project_documents')
      .select('*').eq('project_id', selectedProjectId)
      .eq('doc_type', 'figma_config').single()
    if (data) {
      setConfigDocId(data.id)
      try {
        const config = JSON.parse(data.content)
        setFigmaToken(config.token || '')
        setFigmaFiles(config.files || [])
        setConfigSaved(true)
      } catch { }
    } else {
      setFigmaToken('')
      setFigmaFiles([])
      setConfigSaved(false)
      setConfigDocId(null)
    }
  }

  async function fetchWPData() {
    const [sitesRes, pagesRes] = await Promise.all([
      supabase.from('as_wp_sites').select('id, site_name').eq('project_id', selectedProjectId),
      supabase.from('as_wp_pages').select('id, page_name, site_id').eq('project_id', selectedProjectId),
    ])
    setWpSites(sitesRes.data || [])
    setWpPages(pagesRes.data || [])
  }

  async function saveFigmaConfig() {
    if (!selectedProjectId || !figmaToken) return
    const content = JSON.stringify({ token: figmaToken, files: figmaFiles })
    if (configDocId) {
      await supabase.from('as_project_documents').update({
        content, updated_by: user?.id, updated_at: new Date().toISOString()
      }).eq('id', configDocId)
    } else {
      const { data } = await supabase.from('as_project_documents').insert({
        project_id: selectedProjectId, doc_type: 'figma_config',
        title: 'Figma Config', content, updated_by: user?.id
      }).select().single()
      if (data) setConfigDocId(data.id)
    }
    setConfigSaved(true)
    showFeedback('Figma config saved ✓')
  }

  function extractFileKey(url) {
    const match = url.match(/figma\.com\/(?:file|design)\/([a-zA-Z0-9]+)/)
    return match ? match[1] : null
  }

  function addFigmaFile() {
    if (!newFileUrl) return
    const key = extractFileKey(newFileUrl)
    if (!key) { showFeedback('Invalid Figma URL'); return }
    const name = newFileName || `File ${figmaFiles.length + 1}`
    const newFiles = [...figmaFiles, { key, name, url: newFileUrl }]
    setFigmaFiles(newFiles)
    setNewFileUrl('')
    setNewFileName('')
    setAddingFile(false)
    // Auto save
    saveConfigWithFiles(newFiles)
  }

  async function saveConfigWithFiles(files) {
    if (!selectedProjectId || !figmaToken) return
    const content = JSON.stringify({ token: figmaToken, files })
    if (configDocId) {
      await supabase.from('as_project_documents').update({
        content, updated_by: user?.id, updated_at: new Date().toISOString()
      }).eq('id', configDocId)
    } else {
      const { data } = await supabase.from('as_project_documents').insert({
        project_id: selectedProjectId, doc_type: 'figma_config',
        title: 'Figma Config', content, updated_by: user?.id
      }).select().single()
      if (data) setConfigDocId(data.id)
    }
  }

  async function loadFigmaFile(file) {
    setSelectedFile(file)
    setLoadingFile(true)
    setFileError('')
    setFrames([])
    setSelectedFrame(null)
    setFrameImages({})
    try {
      const res = await fetch(`https://api.figma.com/v1/files/${file.key}`, {
        headers: { 'X-Figma-Token': figmaToken }
      })
      if (!res.ok) throw new Error(`Figma API error: ${res.status}`)
      const data = await res.json()
      setFileData(data)

      // Extract frames/pages
      const extractFrames = (node, path = '') => {
        const results = []
        if (node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'SECTION') {
          results.push({
            id: node.id,
            name: node.name,
            type: node.type,
            path,
            width: node.absoluteBoundingBox?.width,
            height: node.absoluteBoundingBox?.height,
          })
        }
        if (node.children) {
          node.children.forEach(child => {
            results.push(...extractFrames(child, path ? `${path} / ${node.name}` : node.name))
          })
        }
        return results
      }

      const allFrames = []
      if (data.document?.children) {
        data.document.children.forEach(page => {
          if (page.children) {
            page.children.forEach(node => {
              allFrames.push(...extractFrames(node, page.name))
            })
          }
        })
      }
      setFrames(allFrames.slice(0, 50))

      // Set embed URL
      setEmbedUrl(`https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(file.url)}`)
      setActiveTab('browser')
    } catch (err) {
      setFileError(err.message)
    }
    setLoadingFile(false)
  }

  async function loadFrameImage(nodeId) {
    if (frameImages[nodeId] || !selectedFile) return
    try {
      const res = await fetch(
        `https://api.figma.com/v1/images/${selectedFile.key}?ids=${nodeId}&format=png&scale=1`,
        { headers: { 'X-Figma-Token': figmaToken } }
      )
      if (!res.ok) return
      const data = await res.json()
      const imageUrl = data.images?.[nodeId]
      if (imageUrl) {
        setFrameImages(prev => ({ ...prev, [nodeId]: imageUrl }))
      }
    } catch { }
  }

  async function exportFrameToLibrary(frame) {
    if (!selectedProjectId || !selectedFile) return
    setExportingFrame(frame.id)
    try {
      // Get image URL
      let imageUrl = frameImages[frame.id]
      if (!imageUrl) {
        const res = await fetch(
          `https://api.figma.com/v1/images/${selectedFile.key}?ids=${frame.id}&format=png&scale=2`,
          { headers: { 'X-Figma-Token': figmaToken } }
        )
        const data = await res.json()
        imageUrl = data.images?.[frame.id]
      }
      if (!imageUrl) throw new Error('Could not get frame image')

      // Save to asset library
      await supabase.from('as_deliverables').insert({
        project_id: selectedProjectId,
        phase: 'product_modeling',
        title: `Figma: ${frame.name}`,
        file_url: imageUrl,
        deliverable_type: 'generated_image',
        file_type: 'image/png',
        created_by: user?.id, uploaded_by: user?.id
      })
      showFeedback(`"${frame.name}" exported to Asset Library ✓`)
    } catch (err) {
      showFeedback(`Export failed: ${err.message}`)
    }
    setExportingFrame(null)
  }

  async function sendFrameToWP(frame) {
    if (!selectedFile || !wpPages.length) return
    setSendingToWP(frame.id)
    // Find matching WP page by name or let user pick
    const frameUrl = `${selectedFile.url}?node-id=${encodeURIComponent(frame.id)}`
    // Update the first matching WP page or all pages
    const matchingPage = wpPages.find(p =>
      p.page_name.toLowerCase().includes(frame.name.toLowerCase()) ||
      frame.name.toLowerCase().includes(p.page_name.toLowerCase())
    )
    if (matchingPage) {
      await supabase.from('as_wp_pages').update({
        figma_frame_url: frameUrl,
        figma_node_id: frame.id,
        updated_at: new Date().toISOString()
      }).eq('id', matchingPage.id)
      showFeedback(`Frame sent to WP Engine → "${matchingPage.page_name}" ✓`)
    } else {
      // Just store the URL — user can pick page in WP Engine
      showFeedback(`Frame URL copied — paste into WP Engine page ✓`)
      navigator.clipboard.writeText(frameUrl)
    }
    setSendingToWP(null)
  }

  async function extractBrandFromFile() {
    if (!fileData || !selectedProjectId) return
    setExtractingBrand(true)
    try {
      // Extract colors from styles
      const styles = fileData.styles || {}
      const colors = []
      const fonts = []

      Object.values(styles).forEach(style => {
        if (style.styleType === 'FILL') colors.push(style.name)
        if (style.styleType === 'TEXT') fonts.push(style.name)
      })

      // Try to get actual color values from the document
      const extractColors = (node, found = []) => {
        if (node.fills) {
          node.fills.forEach(fill => {
            if (fill.type === 'SOLID' && fill.color) {
              const { r, g, b } = fill.color
              const hex = '#' + [r, g, b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')
              if (!found.includes(hex)) found.push(hex)
            }
          })
        }
        if (node.children && found.length < 20) {
          node.children.forEach(child => extractColors(child, found))
        }
        return found
      }

      const colorValues = extractColors(fileData.document)

      // Get existing brand guide
      const { data: existingDoc } = await supabase.from('as_project_documents')
        .select('*').eq('project_id', selectedProjectId)
        .eq('doc_type', 'brand_identity').single()

      let brandData = {}
      if (existingDoc?.content) {
        try { brandData = JSON.parse(existingDoc.content) } catch { }
      }

      // Merge extracted data
      const primaryColors = colorValues.slice(0, 3).join(', ')
      const secondaryColors = colorValues.slice(3, 6).join(', ')
      const extractedFonts = fonts.slice(0, 5).join(', ')

      const updatedBrand = {
        ...brandData,
        primary_colors: primaryColors || brandData.primary_colors || '',
        secondary_colors: secondaryColors || brandData.secondary_colors || '',
        fonts: extractedFonts || brandData.fonts || '',
        brand_name: brandData.brand_name || fileData.name || '',
      }

      const content = JSON.stringify(updatedBrand)

      if (existingDoc) {
        await supabase.from('as_project_documents').update({
          content, updated_by: user?.id, updated_at: new Date().toISOString()
        }).eq('id', existingDoc.id)
      } else {
        await supabase.from('as_project_documents').insert({
          project_id: selectedProjectId, doc_type: 'brand_identity',
          title: `${fileData.name} Brand Guidelines`,
          content, updated_by: user?.id
        })
      }

      showFeedback(`Brand extracted: ${colorValues.length} colors, ${fonts.length} text styles → Brand Guidelines ✓`)
    } catch (err) {
      showFeedback(`Extract failed: ${err.message}`)
    }
    setExtractingBrand(false)
  }

  function showFeedback(msg) {
    setActionFeedback(msg)
    setTimeout(() => setActionFeedback(''), 4000)
  }

  function getNodeUrl(frame) {
    if (!selectedFile) return ''
    return `${selectedFile.url}?node-id=${encodeURIComponent(frame.id)}`
  }

  return (
    <div className="flex flex-col h-full bg-gray-950 text-white">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">Figma Workspace</h2>
          <p className="text-xs text-gray-400 mt-0.5">Browse files · View designs · Push to WP · Extract brand</p>
        </div>
        <select value={selectedProjectId} onChange={e => setSelectedProjectId(e.target.value)}
          className="bg-gray-800 text-gray-300 text-xs rounded-lg px-3 py-2 border border-gray-700 focus:outline-none">
          <option value="">Select project</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}{p.as_clients?.name ? ` · ${p.as_clients.name}` : ''}</option>)}
        </select>
      </div>

      {/* Tabs */}
      {selectedProjectId && (
        <div className="flex gap-1 px-6 py-3 border-b border-gray-800">
          {[
            { id: 'browser', label: '🗂 File Browser' },
            { id: 'viewer', label: '👁 Embed Viewer' },
            { id: 'settings', label: '⚙️ Settings' },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${activeTab === tab.id ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}>
              {tab.label}
            </button>
          ))}

          {/* Action feedback */}
          {actionFeedback && (
            <div className="ml-auto flex items-center">
              <span className="text-xs text-green-400 bg-green-900/30 px-3 py-1 rounded-lg border border-green-700/50">
                ✓ {actionFeedback}
              </span>
            </div>
          )}
        </div>
      )}

      {!selectedProjectId && (
        <div className="flex-1 flex items-center justify-center text-gray-500">
          <div className="text-center">
            <p className="text-5xl mb-4">🎨</p>
            <p className="text-lg font-medium text-gray-400">Select a project to open Figma Workspace</p>
          </div>
        </div>
      )}

      {selectedProjectId && (
        <div className="flex-1 overflow-hidden flex">

          {/* BROWSER TAB */}
          {activeTab === 'browser' && (
            <div className="flex-1 flex overflow-hidden">
              {/* Left — file list */}
              <div className="w-56 border-r border-gray-800 flex flex-col">
                <div className="p-4 border-b border-gray-800">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Files</p>
                  {figmaFiles.map(file => (
                    <button key={file.key} onClick={() => loadFigmaFile(file)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs mb-1 transition-colors ${selectedFile?.key === file.key ? 'bg-purple-600 text-white' : 'text-gray-300 hover:bg-gray-800'}`}>
                      <p className="font-medium truncate">{file.name}</p>
                      <p className="text-gray-500 truncate text-xs mt-0.5">{file.key.slice(0, 8)}...</p>
                    </button>
                  ))}
                  {figmaFiles.length === 0 && (
                    <p className="text-xs text-gray-600 italic">No files yet — add in Settings</p>
                  )}
                </div>

                {/* Figma actions */}
                {selectedFile && fileData && (
                  <div className="p-4 space-y-2">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Actions</p>
                    <button onClick={extractBrandFromFile} disabled={extractingBrand}
                      className="w-full text-left text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-2 rounded-lg border border-gray-700 transition-colors disabled:opacity-50">
                      {extractingBrand ? '⏳ Extracting...' : '🎨 Extract brand colors & fonts'}
                    </button>
                    <button onClick={() => setActiveTab('viewer')}
                      className="w-full text-left text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-2 rounded-lg border border-gray-700 transition-colors">
                      👁 Open in viewer
                    </button>
                    <a href={selectedFile.url} target="_blank" rel="noopener noreferrer"
                      className="block text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-2 rounded-lg border border-gray-700 transition-colors">
                      ↗ Open in Figma
                    </a>
                  </div>
                )}
              </div>

              {/* Right — frame browser */}
              <div className="flex-1 overflow-y-auto p-5">
                {!selectedFile && (
                  <div className="h-full flex items-center justify-center text-gray-500">
                    <div className="text-center">
                      <p className="text-4xl mb-3">📁</p>
                      <p className="text-sm">Select a file to browse frames</p>
                      {figmaFiles.length === 0 && (
                        <button onClick={() => setActiveTab('settings')}
                          className="mt-3 text-xs text-purple-400 hover:text-purple-300">
                          + Add Figma files in Settings →
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {loadingFile && (
                  <div className="h-full flex items-center justify-center text-gray-500">
                    <div className="text-center">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500 mx-auto mb-3" />
                      <p className="text-sm">Loading Figma file...</p>
                    </div>
                  </div>
                )}

                {fileError && (
                  <div className="bg-red-900/30 border border-red-700/50 rounded-xl p-4">
                    <p className="text-sm text-red-300">❌ {fileError}</p>
                    <p className="text-xs text-gray-500 mt-1">Check your Figma token in Settings and make sure you have access to this file.</p>
                  </div>
                )}

                {!loadingFile && !fileError && selectedFile && frames.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-sm font-semibold text-white">{selectedFile.name}</h3>
                        <p className="text-xs text-gray-400 mt-0.5">{frames.length} frames found</p>
                      </div>
                      {fileData?.lastModified && (
                        <p className="text-xs text-gray-500">Last modified: {new Date(fileData.lastModified).toLocaleDateString()}</p>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      {frames.map(frame => (
                        <div key={frame.id}
                          className={`bg-gray-800 rounded-xl border transition-all cursor-pointer ${selectedFrame?.id === frame.id ? 'border-purple-500' : 'border-gray-700 hover:border-gray-600'}`}
                          onClick={() => {
                            setSelectedFrame(frame)
                            loadFrameImage(frame.id)
                            setEmbedUrl(`https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(getNodeUrl(frame))}`)
                          }}>
                          {/* Frame preview */}
                          <div className="bg-gray-900 rounded-t-xl overflow-hidden"
                            style={{ height: '140px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            {frameImages[frame.id] ? (
                              <img src={frameImages[frame.id]} alt={frame.name}
                                className="w-full h-full object-contain p-2" />
                            ) : (
                              <div className="text-center text-gray-600">
                                <p className="text-2xl mb-1">🖼️</p>
                                <p className="text-xs">Click to preview</p>
                                {frame.width && <p className="text-xs mt-0.5">{Math.round(frame.width)}×{Math.round(frame.height)}</p>}
                              </div>
                            )}
                          </div>

                          <div className="p-3">
                            <p className="text-xs font-semibold text-white truncate">{frame.name}</p>
                            <p className="text-xs text-gray-500 truncate mt-0.5">{frame.path}</p>

                            {/* Actions */}
                            {selectedFrame?.id === frame.id && (
                              <div className="flex gap-1 mt-2 flex-wrap">
                                <button onClick={e => { e.stopPropagation(); setActiveTab('viewer') }}
                                  className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded transition-colors">
                                  👁 View
                                </button>
                                <button
                                  onClick={e => { e.stopPropagation(); exportFrameToLibrary(frame) }}
                                  disabled={exportingFrame === frame.id}
                                  className="text-xs bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-2 py-1 rounded transition-colors">
                                  {exportingFrame === frame.id ? '⏳' : '📁 Export'}
                                </button>
                                <button
                                  onClick={e => { e.stopPropagation(); sendFrameToWP(frame) }}
                                  disabled={sendingToWP === frame.id}
                                  className="text-xs bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-2 py-1 rounded transition-colors">
                                  {sendingToWP === frame.id ? '⏳' : '🚀 → WP'}
                                </button>
                                <a href={getNodeUrl(frame)} target="_blank" rel="noopener noreferrer"
                                  onClick={e => e.stopPropagation()}
                                  className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-2 py-1 rounded transition-colors">
                                  ↗ Figma
                                </a>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* EMBED VIEWER TAB */}
          {activeTab === 'viewer' && (
            <div className="flex-1 flex flex-col">
              {!embedUrl ? (
                <div className="flex-1 flex items-center justify-center text-gray-500">
                  <div className="text-center">
                    <p className="text-4xl mb-3">👁</p>
                    <p className="text-sm">Select a file or frame in the Browser tab first</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="px-4 py-2 border-b border-gray-800 flex items-center gap-3">
                    <p className="text-xs text-gray-400 flex-1 truncate">{selectedFrame?.name || selectedFile?.name}</p>
                    {selectedFrame && (
                      <div className="flex gap-2">
                        <button onClick={() => exportFrameToLibrary(selectedFrame)}
                          disabled={exportingFrame === selectedFrame.id}
                          className="text-xs bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg">
                          {exportingFrame === selectedFrame.id ? '⏳' : '📁 Export to Library'}
                        </button>
                        <button onClick={() => sendFrameToWP(selectedFrame)}
                          disabled={sendingToWP === selectedFrame.id}
                          className="text-xs bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg">
                          {sendingToWP === selectedFrame.id ? '⏳' : '🚀 Send to WP Engine'}
                        </button>
                      </div>
                    )}
                    <a href={embedUrl.replace('embed?embed_host=share&url=', '').replace(encodeURIComponent(''), '')}
                      target="_blank" rel="noopener noreferrer"
                      className="text-xs text-blue-400 hover:text-blue-300">↗ Open in Figma</a>
                  </div>
                  <div className="flex-1">
                    <iframe
                      src={embedUrl}
                      className="w-full h-full border-0"
                      allowFullScreen
                      title="Figma Design"
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {/* SETTINGS TAB */}
          {activeTab === 'settings' && (
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <div className="bg-gray-800 rounded-xl p-5 border border-gray-700 space-y-4">
                <h3 className="text-sm font-semibold text-white">Figma Connection</h3>

                <div>
                  <label className="block text-xs text-gray-400 mb-1">Personal Access Token</label>
                  <input type="password" value={figmaToken}
                    onChange={e => { setFigmaToken(e.target.value); setConfigSaved(false) }}
                    className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                    placeholder="figd_..." />
                  <p className="text-xs text-gray-500 mt-1">Figma → Settings → Personal access tokens → Generate new token</p>
                </div>

                <button onClick={saveFigmaConfig} disabled={!figmaToken}
                  className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium">
                  {configSaved ? '✓ Saved' : 'Save Token'}
                </button>
              </div>

              {/* Files */}
              <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-white">Figma Files ({figmaFiles.length})</h3>
                  <button onClick={() => setAddingFile(!addingFile)}
                    className="text-xs bg-purple-600 hover:bg-purple-700 text-white px-3 py-1.5 rounded-lg">
                    + Add File
                  </button>
                </div>

                {addingFile && (
                  <div className="bg-gray-700 rounded-xl p-4 mb-4 space-y-3">
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Figma File URL *</label>
                      <input value={newFileUrl} onChange={e => setNewFileUrl(e.target.value)}
                        className="w-full bg-gray-600 text-white rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                        placeholder="https://www.figma.com/file/..." />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Display Name</label>
                      <input value={newFileName} onChange={e => setNewFileName(e.target.value)}
                        className="w-full bg-gray-600 text-white rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                        placeholder="Client Website Design" />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={addFigmaFile}
                        className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-4 py-1.5 rounded">Add</button>
                      <button onClick={() => setAddingFile(false)}
                        className="text-gray-400 text-xs hover:text-white px-3">Cancel</button>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  {figmaFiles.map((file, i) => (
                    <div key={file.key} className="flex items-center gap-3 bg-gray-700/50 rounded-lg px-3 py-2">
                      <div className="w-6 h-6 bg-purple-600 rounded flex items-center justify-center text-xs flex-shrink-0">F</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white truncate">{file.name}</p>
                        <p className="text-xs text-gray-500 truncate">{file.url}</p>
                      </div>
                      <button onClick={() => {
                        const newFiles = figmaFiles.filter((_, idx) => idx !== i)
                        setFigmaFiles(newFiles)
                        saveConfigWithFiles(newFiles)
                      }} className="text-xs text-red-400 hover:text-red-300 flex-shrink-0">Remove</button>
                    </div>
                  ))}
                  {figmaFiles.length === 0 && (
                    <p className="text-xs text-gray-500 text-center py-4">No files added yet</p>
                  )}
                </div>
              </div>

              {/* WP connection status */}
              {wpPages.length > 0 && (
                <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
                  <h3 className="text-sm font-semibold text-white mb-3">WP Engine Connection</h3>
                  <p className="text-xs text-gray-400 mb-2">
                    {wpPages.length} pages in WP Engine — frames sent from here will auto-link to matching pages
                  </p>
                  <div className="space-y-1">
                    {wpPages.map(p => (
                      <div key={p.id} className="flex items-center gap-2 text-xs text-gray-400">
                        <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                        {p.page_name}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* How it works */}
              <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
                <h3 className="text-sm font-semibold text-white mb-3">How the workflow works</h3>
                <div className="space-y-3">
                  {[
                    { step: '1', title: 'Add Figma token + files', desc: 'Connect your Figma account and add the client design file URLs' },
                    { step: '2', title: 'Browse & preview frames', desc: 'See all frames from the file, click to preview and select' },
                    { step: '3', title: 'Extract brand', desc: 'Pull colors and fonts from the design into Brand Guidelines automatically' },
                    { step: '4', title: 'Export to Asset Library', desc: 'Save any frame as an image to the project asset library' },
                    { step: '5', title: 'Send frame to WP Engine', desc: 'Link a Figma frame to a WP page — Claude uses it to generate the Elementor layout' },
                  ].map(item => (
                    <div key={item.step} className="flex gap-3">
                      <div className="w-5 h-5 rounded-full bg-purple-600 flex items-center justify-center text-xs flex-shrink-0 mt-0.5">{item.step}</div>
                      <div>
                        <p className="text-xs font-medium text-white">{item.title}</p>
                        <p className="text-xs text-gray-500">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
