import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'

const STATUS_COLORS = {
  pending: 'bg-gray-700 text-gray-300',
  generating: 'bg-blue-900/50 text-blue-300',
  pushing: 'bg-yellow-900/50 text-yellow-300',
  live: 'bg-green-900/50 text-green-300',
  needs_review: 'bg-orange-900/50 text-orange-300',
}

const PAGE_TYPES = ['page', 'post', 'landing', 'service', 'homepage', 'about', 'contact', 'blog']

export default function SphereWPEngine() {
  const { user, profile } = useAuth()
  const [projects, setProjects] = useState([])
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [sites, setSites] = useState([])
  const [selectedSite, setSelectedSite] = useState(null)
  const [pages, setPages] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('setup')

  // Site form
  const [showSiteForm, setShowSiteForm] = useState(false)
  const [siteForm, setSiteForm] = useState({
    site_name: '', site_url: '', wp_username: '',
    wp_app_password: '', figma_file_url: '', figma_token: '', theme_name: '', notes: ''
  })
  const [savingSite, setSavingSite] = useState(false)

  // Page form
  const [showPageForm, setShowPageForm] = useState(false)
  const [pageForm, setPageForm] = useState({
    page_name: '', page_type: 'page', slug: '',
    figma_frame_url: '', content: '',
    meta_title: '', meta_description: '', assigned_to: ''
  })

  // Generation state
  const [generatingPage, setGeneratingPage] = useState(null)
  const [generationLog, setGenerationLog] = useState([])
  const [pushingPage, setPushingPage] = useState(null)
  const [editingPage, setEditingPage] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [wpTestResult, setWpTestResult] = useState(null)
  const [testingWP, setTestingWP] = useState(false)
  const [figmaPreview, setFigmaPreview] = useState(null)
  const [fetchingFigma, setFetchingFigma] = useState(false)
  const logEndRef = useRef(null)

  // Sync from WP
  const [showSyncModal, setShowSyncModal] = useState(false)
  const [wpLivePages, setWpLivePages] = useState([])
  const [syncLoading, setSyncLoading] = useState(false)
  const [syncError, setSyncError] = useState('')
  const [selectedForImport, setSelectedForImport] = useState([])
  const [importing, setImporting] = useState(false)
  const [importFilter, setImportFilter] = useState('all')

  useEffect(() => { fetchProjects(); fetchMembers() }, [])
  useEffect(() => { if (selectedProjectId) fetchSites() }, [selectedProjectId])
  useEffect(() => { if (selectedSite) fetchPages() }, [selectedSite])
  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [generationLog])

  async function fetchProjects() {
    const { data } = await supabase.from('as_projects')
      .select('id, name, as_clients(name)').order('name')
    setProjects(data || [])
  }

  async function fetchMembers() {
    const { data } = await supabase.from('profiles')
      .select('id, full_name, email, department').order('full_name')
    setMembers(data || [])
  }

  async function fetchSites() {
    const { data } = await supabase.from('as_wp_sites')
      .select('*').eq('project_id', selectedProjectId).order('created_at')
    setSites(data || [])
    if (data?.length) setSelectedSite(data[0])
  }

  async function fetchPages() {
    if (!selectedSite) return
    const { data } = await supabase.from('as_wp_pages')
      .select('*').eq('site_id', selectedSite.id).order('created_at')
    setPages(data || [])
  }

  async function saveSite() {
    if (!siteForm.site_name || !siteForm.site_url || !siteForm.wp_username || !siteForm.wp_app_password) return
    setSavingSite(true)
    const cleanUrl = siteForm.site_url.replace(/\/$/, '')
    const { data, error } = await supabase.from('as_wp_sites').insert({
      ...siteForm,
      site_url: cleanUrl,
      project_id: selectedProjectId,
      created_by: user?.id
    }).select().single()
    if (!error && data) {
      setSites(prev => [...prev, data])
      setSelectedSite(data)
      setShowSiteForm(false)
      setSiteForm({ site_name: '', site_url: '', wp_username: '', wp_app_password: '', figma_file_url: '', figma_token: '', theme_name: '', notes: '' })
      setActiveTab('pages')
    }
    setSavingSite(false)
  }

  async function testWPConnection() {
    if (!selectedSite) return
    setTestingWP(true)
    setWpTestResult(null)
    try {
      const credentials = btoa(`${selectedSite.wp_username}:${selectedSite.wp_app_password}`)
      const response = await fetch(`${selectedSite.site_url}/wp-json/wp/v2/users/me`, {
        headers: { Authorization: `Basic ${credentials}` }
      })
      if (response.ok) {
        const data = await response.json()
        setWpTestResult({ success: true, message: `Connected as: ${data.name}` })
      } else {
        setWpTestResult({ success: false, message: `Connection failed: ${response.status} ${response.statusText}` })
      }
    } catch (err) {
      setWpTestResult({ success: false, message: `Error: ${err.message}` })
    }
    setTestingWP(false)
  }

  async function fetchFigmaPreview(frameUrl) {
    if (!frameUrl || !selectedSite?.figma_token) return
    setFetchingFigma(true)
    try {
      const fileMatch = frameUrl.match(/figma\.com\/(?:file|design)\/([^/]+)/)
      const nodeMatch = frameUrl.match(/node-id=([^&]+)/)
      if (!fileMatch) { setFetchingFigma(false); return }
      const fileKey = fileMatch[1]
      const nodeId = nodeMatch ? nodeMatch[1] : null

      const url = nodeId
        ? `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${nodeId}`
        : `https://api.figma.com/v1/files/${fileKey}`

      const res = await fetch(url, {
        headers: { 'X-Figma-Token': selectedSite.figma_token }
      })
      if (!res.ok) throw new Error('Figma API error')
      const data = await res.json()
      setFigmaPreview(data)
    } catch (err) {
      console.error('Figma fetch error:', err)
    }
    setFetchingFigma(false)
  }

  function addLog(message, type = 'info') {
    setGenerationLog(prev => [...prev, {
      message, type, ts: new Date().toLocaleTimeString()
    }])
  }

  async function generateElementorPage(page) {
    setGeneratingPage(page.id)
    setGenerationLog([])
    setActiveTab('generator')

    addLog('Starting Elementor page generation...', 'info')
    addLog(`Page: ${page.page_name} (${page.page_type})`, 'info')

    const project = projects.find(p => p.id === selectedProjectId)

    const { data: brandDoc } = await supabase
      .from('as_project_documents')
      .select('content')
      .eq('project_id', selectedProjectId)
      .eq('doc_type', 'brand_identity')
      .single()

    let brandContext = ''
    if (brandDoc?.content) {
      try {
        const brand = JSON.parse(brandDoc.content)
        brandContext = `
Brand: ${brand.brand_name}
Colors: Primary: ${brand.primary_colors}, Secondary: ${brand.secondary_colors}
Fonts: ${brand.fonts}
Tone: ${brand.brand_tone}
Positioning: ${brand.brand_positioning}`
      } catch { brandContext = brandDoc.content }
    }

    const { data: pageKeyword } = await supabase
      .from('as_project_pages')
      .select('primary_keyword, primary_kw_volume')
      .eq('project_id', selectedProjectId)
      .ilike('page_name', `%${page.page_name}%`)
      .single()

    addLog('Fetching project context and brand guidelines...', 'info')
    if (brandContext) addLog('Brand guidelines loaded ✓', 'success')
    if (pageKeyword) addLog(`Primary keyword: ${pageKeyword.primary_keyword} ✓`, 'success')

    let figmaContext = ''
    if (page.figma_frame_url && selectedSite?.figma_token) {
      addLog('Fetching Figma design specs...', 'info')
      try {
        const fileMatch = page.figma_frame_url.match(/figma\.com\/(?:file|design)\/([^/]+)/)
        const nodeMatch = page.figma_frame_url.match(/node-id=([^&]+)/)
        if (fileMatch) {
          const fileKey = fileMatch[1]
          const nodeId = nodeMatch ? decodeURIComponent(nodeMatch[1]) : null
          const url = nodeId
            ? `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${nodeId}`
            : `https://api.figma.com/v1/files/${fileKey}`
          const res = await fetch(url, {
            headers: { 'X-Figma-Token': selectedSite.figma_token }
          })
          if (res.ok) {
            const figmaData = await res.json()
            const extractNodes = (node, depth = 0) => {
              if (depth > 3) return ''
              let summary = `${'  '.repeat(depth)}${node.type}: ${node.name}\n`
              if (node.children) {
                summary += node.children.slice(0, 8).map(c => extractNodes(c, depth + 1)).join('')
              }
              return summary
            }
            const rootNode = figmaData.nodes ? Object.values(figmaData.nodes)[0]?.document : figmaData.document
            if (rootNode) {
              figmaContext = `\nFigma Structure:\n${extractNodes(rootNode)}`
              addLog('Figma design specs loaded ✓', 'success')
            }
          }
        }
      } catch (err) {
        addLog(`Figma fetch failed: ${err.message}`, 'warning')
      }
    }

    addLog('Sending to Claude AI for Elementor generation...', 'info')

    const systemPrompt = `You are an expert WordPress Elementor developer. Generate a complete Elementor page JSON structure.

IMPORTANT: Return ONLY valid JSON, no markdown, no explanation, no code blocks.
The JSON must be a valid Elementor page data array that can be imported directly.

Elementor JSON structure:
[{
  "id": "unique_id",
  "elType": "section",
  "settings": { "background_color": "#ffffff", "padding": {"top":"80","bottom":"80","left":"20","right":"20","unit":"px","isLinked":false} },
  "elements": [{
    "id": "unique_id",
    "elType": "column", 
    "settings": {"_column_size": 100},
    "elements": [{
      "id": "unique_id",
      "elType": "widget",
      "widgetType": "heading",
      "settings": {
        "title": "Your Heading",
        "header_size": "h1",
        "title_color": "#333333",
        "typography_font_size": {"unit":"px","size":48}
      }
    }]
  }]
}]

Available widgets: heading, text-editor, image, button, icon-box, image-box, divider, spacer, video, google_maps, contact-form-7, html, section (nested)

Generate professional, conversion-focused layouts. Use proper spacing, hierarchy, and visual flow.`

    const userPrompt = `Generate an Elementor page JSON for:

Page: ${page.page_name}
Type: ${page.page_type}
Slug: /${page.slug || page.page_name.toLowerCase().replace(/\s+/g, '-')}
Content brief: ${page.content || 'Professional page for ' + page.page_name}
Meta title: ${page.meta_title || page.page_name}
${brandContext ? `\n${brandContext}` : ''}
${pageKeyword ? `\nTarget keyword: ${pageKeyword.primary_keyword}` : ''}
${figmaContext ? `\n${figmaContext}` : ''}

Create a complete, professional ${page.page_type} page with appropriate sections:
- Hero section with headline and CTA
- Main content sections based on page type
- Proper typography and spacing
- Professional color scheme based on brand colors
- Mobile-responsive structure

Return ONLY the Elementor JSON array.`

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': import.meta.env.VITE_CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 8000,
          system: systemPrompt,
          messages: [
            { role: 'user', content: userPrompt },
            { role: 'assistant', content: '[{"id":"' }
          ]
        })
      })

      const data = await response.json()
      const rawText = '[{"id":"' + (data.content?.[0]?.text || '')

      addLog('Claude response received, parsing JSON...', 'info')
      addLog(`Raw response preview: ${rawText.slice(0, 200)}`, 'info')

      let elementorJson
      try {
        const cleaned = rawText
          .replace(/```json\n?/g, '')
          .replace(/```\n?/g, '')
          .trim()
        elementorJson = JSON.parse(cleaned)
        addLog(`Generated ${elementorJson.length} sections ✓`, 'success')
      } catch (parseErr) {
        addLog('JSON parse failed — trying to extract...', 'warning')
        const jsonMatch = rawText.match(/\[[\s\S]+\]/)
        if (jsonMatch) {
          elementorJson = JSON.parse(jsonMatch[0])
          addLog(`Extracted ${elementorJson.length} sections ✓`, 'success')
        } else {
          throw new Error('Could not parse Elementor JSON from response')
        }
      }

      await supabase.from('as_wp_pages').update({
        elementor_json: elementorJson,
        status: 'generating',
        updated_at: new Date().toISOString()
      }).eq('id', page.id)

      addLog('Elementor JSON saved to database ✓', 'success')
      addLog('Ready to push to WordPress!', 'success')

      fetchPages()

    } catch (err) {
      addLog(`Generation failed: ${err.message}`, 'error')
    }

    setGeneratingPage(null)
  }

  async function pushToWordPress(page) {
    if (!page.elementor_json || !selectedSite) return
    setPushingPage(page.id)
    addLog(`Pushing "${page.page_name}" to WordPress...`, 'info')

    try {
      const credentials = btoa(`${selectedSite.wp_username}:${selectedSite.wp_app_password}`)

      const pageData = {
        title: page.page_name,
        slug: page.slug || page.page_name.toLowerCase().replace(/\s+/g, '-'),
        status: 'draft',
        meta: {
          _elementor_edit_mode: 'builder',
          _elementor_template_type: 'wp-page',
          _elementor_version: '3.0.0',
          _elementor_data: JSON.stringify(page.elementor_json),
          _yoast_wpseo_title: page.meta_title || page.page_name,
          _yoast_wpseo_metadesc: page.meta_description || '',
        }
      }

      addLog('Sending to WP REST API...', 'info')

      const endpoint = page.wp_page_id
        ? `${selectedSite.site_url}/wp-json/wp/v2/pages/${page.wp_page_id}`
        : `${selectedSite.site_url}/wp-json/wp/v2/pages`

      const response = await fetch(endpoint, {
        method: page.wp_page_id ? 'PUT' : 'POST',
        headers: {
          Authorization: `Basic ${credentials}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(pageData)
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err.message || `WP API error: ${response.status}`)
      }

      const wpPage = await response.json()
      addLog(`Page created in WordPress! ID: ${wpPage.id} ✓`, 'success')
      addLog(`Edit URL: ${selectedSite.site_url}/wp-admin/post.php?post=${wpPage.id}&action=elementor`, 'success')

      await supabase.from('as_wp_pages').update({
        wp_page_id: wpPage.id,
        wp_page_url: wpPage.link,
        status: 'live',
        pushed_at: new Date().toISOString()
      }).eq('id', page.id)

      addLog('Database updated ✓', 'success')
      addLog('✅ Done! Open Elementor to review and style.', 'success')

      fetchPages()

    } catch (err) {
      addLog(`Push failed: ${err.message}`, 'error')
      if (err.message.includes('fetch')) {
        addLog('CORS error detected. Your WP site needs to allow cross-origin requests.', 'warning')
        addLog('Install "WP CORS" plugin or add to functions.php:', 'warning')
        addLog("add_action('rest_api_init', function() { header('Access-Control-Allow-Origin: *'); });", 'info')
      }
    }

    setPushingPage(null)
  }

  async function savePageEdit() {
    if (!editingPage) return
    await supabase.from('as_wp_pages').update({
      ...editForm,
      updated_at: new Date().toISOString()
    }).eq('id', editingPage)
    setEditingPage(null)
    fetchPages()
  }

  async function fetchWPLivePages() {
    if (!selectedSite) return
    setSyncLoading(true)
    setSyncError('')
    setWpLivePages([])
    setSelectedForImport([])
    try {
      const credentials = btoa(`${selectedSite.wp_username}:${selectedSite.wp_app_password}`)
      let allPages = []
      let page = 1
      while (true) {
        const res = await fetch(
          `${selectedSite.site_url}/wp-json/wp/v2/pages?per_page=100&page=${page}&_fields=id,title,slug,status,link,modified,content,excerpt,yoast_head_json,meta`,
          { headers: { Authorization: `Basic ${credentials}` } }
        )
        if (!res.ok) throw new Error(`WP API error: ${res.status}`)
        const data = await res.json()
        if (!data.length) break
        allPages = [...allPages, ...data]
        if (data.length < 100) break
        page++
      }
      setWpLivePages(allPages)
    } catch (err) {
      setSyncError(err.message)
    }
    setSyncLoading(false)
  }

  async function importSelectedPages() {
    if (!selectedForImport.length || !selectedSite) return
    setImporting(true)
    const toImport = wpLivePages.filter(p => selectedForImport.includes(p.id))
    const inserts = toImport.map(p => {
      const yoast = p.yoast_head_json || {}
      return {
        site_id: selectedSite.id,
        project_id: selectedProjectId,
        page_name: p.title?.rendered || p.slug,
        slug: p.slug,
        page_type: 'page',
        wp_page_id: p.id,
        wp_page_url: p.link,
        status: 'needs_review',
        content: p.content?.rendered?.replace(/<[^>]+>/g, '').slice(0, 500) || '',
        meta_title: yoast.title || p.title?.rendered || '',
        meta_description: yoast.description || '',
        figma_frame_url: null,
        elementor_json: null,
        pushed_at: p.modified ? new Date(p.modified).toISOString() : null,
      }
    })
    const { error } = await supabase.from('as_wp_pages').insert(inserts)
    if (!error) {
      setShowSyncModal(false)
      setSelectedForImport([])
      fetchPages()
    }
    setImporting(false)
  }

  async function addPage() {
    if (!pageForm.page_name || !selectedSite) return
    const { error } = await supabase.from('as_wp_pages').insert({
      ...pageForm,
      site_id: selectedSite.id,
      project_id: selectedProjectId,
      assigned_to: pageForm.assigned_to || null,
      status: 'pending'
    })
    if (!error) {
      setShowPageForm(false)
      setPageForm({ page_name: '', page_type: 'page', slug: '', figma_frame_url: '', content: '', meta_title: '', meta_description: '', assigned_to: '' })
      fetchPages()
    }
  }

  const overallProgress = pages.length > 0
    ? Math.round((pages.filter(p => p.status === 'live').length / pages.length) * 100)
    : 0

  return (
    <div className="flex flex-col h-full bg-gray-950 text-white">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">WP Engine</h2>
          <p className="text-xs text-gray-400 mt-0.5">Figma → Elementor → WordPress automation</p>
        </div>
        <select value={selectedProjectId} onChange={e => setSelectedProjectId(e.target.value)}
          className="bg-gray-800 text-gray-300 text-xs rounded-lg px-3 py-2 border border-gray-700 focus:outline-none focus:ring-1 focus:ring-purple-500">
          <option value="">Select project</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}{p.as_clients?.name ? ` · ${p.as_clients.name}` : ''}</option>)}
        </select>
      </div>

      {/* Site selector */}
      {selectedProjectId && (
        <div className="px-6 py-3 border-b border-gray-800 flex items-center gap-3">
          <div className="flex gap-2 flex-1 overflow-x-auto">
            {sites.map(site => (
              <div key={site.id} className="flex items-center gap-1">
                <button onClick={() => setSelectedSite(site)}
                  className={`px-3 py-1.5 text-xs rounded-lg whitespace-nowrap transition-colors ${selectedSite?.id === site.id ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'}`}>
                  {site.site_name}
                </button>
                {/* Delete site button */}
                <button
                  onClick={async () => {
                    if (!confirm(`Delete "${site.site_name}"? This will also delete all its pages.`)) return
                    await supabase.from('as_wp_pages').delete().eq('site_id', site.id)
                    await supabase.from('as_wp_sites').delete().eq('id', site.id)
                    setSites(prev => prev.filter(s => s.id !== site.id))
                    if (selectedSite?.id === site.id) setSelectedSite(null)
                  }}
                  className="w-5 h-5 flex items-center justify-center text-gray-600 hover:text-red-400 hover:bg-gray-800 rounded transition-colors text-xs">
                  ✕
                </button>
              </div>
            ))}
            {sites.length === 0 && (
              <p className="text-xs text-gray-500 py-1.5">No sites yet — add one below</p>
            )}
          </div>
          <button onClick={() => { setShowSiteForm(true); setSelectedSite(null) }}
            className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-3 py-1.5 rounded-lg flex-shrink-0">
            + Add Site
          </button>
        </div>
      )}

      {/* Tabs */}
      {selectedSite && (
        <div className="flex gap-1 px-6 py-3 border-b border-gray-800">
          {[
            { id: 'setup', label: '⚙️ Setup' },
            { id: 'pages', label: '📄 Pages' },
            { id: 'generator', label: '🤖 Generator' },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${activeTab === tab.id ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}>
              {tab.label}
            </button>
          ))}
          {pages.length > 0 && (
            <div className="ml-auto flex items-center gap-2">
              <div className="w-24 bg-gray-700 rounded-full h-1.5">
                <div className="bg-green-500 h-1.5 rounded-full" style={{ width: `${overallProgress}%` }} />
              </div>
              <span className="text-xs text-gray-400">{overallProgress}% live</span>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-6">

        {/* No project selected */}
        {!selectedProjectId && (
          <div className="text-center py-20 text-gray-500">
            <p className="text-5xl mb-4">🔌</p>
            <p className="text-lg font-medium text-gray-400">Select a project to get started</p>
            <p className="text-sm mt-1">Connect your WordPress site and start automating page builds</p>
          </div>
        )}

        {/* Add site form */}
        {showSiteForm && selectedProjectId && (
          <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 mb-6 space-y-4">
            <h3 className="text-sm font-semibold text-white">Connect WordPress Site</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Site Name *</label>
                <input value={siteForm.site_name} onChange={e => setSiteForm({...siteForm, site_name: e.target.value})}
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                  placeholder="REL Website" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Site URL *</label>
                <input value={siteForm.site_url} onChange={e => setSiteForm({...siteForm, site_url: e.target.value})}
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                  placeholder="https://royalexecutivelimo.com" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">WP Username *</label>
                <input value={siteForm.wp_username} onChange={e => setSiteForm({...siteForm, wp_username: e.target.value})}
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                  placeholder="admin" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Application Password *</label>
                <input type="password" value={siteForm.wp_app_password} onChange={e => setSiteForm({...siteForm, wp_app_password: e.target.value})}
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                  placeholder="xxxx xxxx xxxx xxxx xxxx xxxx" />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Figma File URL</label>
                <input value={siteForm.figma_file_url} onChange={e => setSiteForm({...siteForm, figma_file_url: e.target.value})}
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                  placeholder="https://figma.com/file/..." />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Figma Access Token</label>
                <input type="password" value={siteForm.figma_token} onChange={e => setSiteForm({...siteForm, figma_token: e.target.value})}
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                  placeholder="figd_..." />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Theme/Framework</label>
                <input value={siteForm.theme_name} onChange={e => setSiteForm({...siteForm, theme_name: e.target.value})}
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                  placeholder="Hello Elementor, Astra..." />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Notes</label>
                <input value={siteForm.notes} onChange={e => setSiteForm({...siteForm, notes: e.target.value})}
                  className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500" />
              </div>
            </div>
            <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-3">
              <p className="text-xs text-blue-300 font-medium mb-1">How to get Application Password:</p>
              <p className="text-xs text-gray-400">WP Admin → Users → Your Profile → scroll to "Application Passwords" → Add New → copy the generated password</p>
            </div>
            <div className="flex gap-3">
              <button onClick={saveSite} disabled={savingSite}
                className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium">
                {savingSite ? 'Connecting...' : 'Connect Site'}
              </button>
              <button onClick={() => setShowSiteForm(false)} className="text-gray-400 text-sm hover:text-white px-3">Cancel</button>
            </div>
          </div>
        )}

        {/* SETUP TAB */}
        {activeTab === 'setup' && selectedSite && (
          <div className="space-y-4">
            <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-base font-bold text-white">{selectedSite.site_name}</h3>
                  <a href={selectedSite.site_url} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-blue-400 hover:text-blue-300">{selectedSite.site_url}</a>
                </div>
                <button onClick={testWPConnection} disabled={testingWP}
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded-lg">
                  {testingWP ? 'Testing...' : '🔌 Test Connection'}
                </button>
              </div>

              {wpTestResult && (
                <div className={`rounded-lg p-3 mb-4 ${wpTestResult.success ? 'bg-green-900/30 border border-green-700/50' : 'bg-red-900/30 border border-red-700/50'}`}>
                  <p className={`text-xs font-medium ${wpTestResult.success ? 'text-green-300' : 'text-red-300'}`}>
                    {wpTestResult.success ? '✅' : '❌'} {wpTestResult.message}
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="bg-gray-700/50 rounded-lg p-3">
                  <p className="text-gray-400 mb-1">WordPress User</p>
                  <p className="text-white">{selectedSite.wp_username}</p>
                </div>
                <div className="bg-gray-700/50 rounded-lg p-3">
                  <p className="text-gray-400 mb-1">Theme</p>
                  <p className="text-white">{selectedSite.theme_name || 'Not specified'}</p>
                </div>
                <div className="bg-gray-700/50 rounded-lg p-3">
                  <p className="text-gray-400 mb-1">Figma Connected</p>
                  <p className={selectedSite.figma_token ? 'text-green-400' : 'text-gray-500'}>
                    {selectedSite.figma_token ? '✓ Yes' : '✗ No token'}
                  </p>
                </div>
                <div className="bg-gray-700/50 rounded-lg p-3">
                  <p className="text-gray-400 mb-1">Pages</p>
                  <p className="text-white">{pages.length} tracked · {pages.filter(p => p.status === 'live').length} live</p>
                </div>
              </div>
            </div>

            {/* CORS fix instructions */}
            <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-xl p-4">
              <h4 className="text-xs font-semibold text-yellow-300 mb-2">⚠️ Required: Enable CORS on WordPress</h4>
              <p className="text-xs text-gray-400 mb-2">For the WP REST API to work from Anka OS, add this to your theme's <code className="text-yellow-300">functions.php</code>:</p>
              <pre className="text-xs bg-gray-900 text-green-300 rounded-lg p-3 overflow-x-auto">{`add_action('rest_api_init', function() {
  remove_filter('rest_pre_serve_request', 'rest_send_cors_headers');
  add_filter('rest_pre_serve_request', function($value) {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Authorization, Content-Type');
    return $value;
  });
}, 15);`}</pre>
              <p className="text-xs text-gray-500 mt-2">Or install the "WP CORS" plugin for a no-code option.</p>
            </div>
          </div>
        )}

        {/* PAGES TAB */}
        {activeTab === 'pages' && selectedSite && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-300">Pages ({pages.length})</h3>
              <div className="flex gap-2">
                <button
                  onClick={() => { setShowSyncModal(true); fetchWPLivePages() }}
                  className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 py-1.5 rounded-lg">
                  🔄 Sync from WP
                </button>
                <button onClick={() => setShowPageForm(!showPageForm)}
                  className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-3 py-1.5 rounded-lg">
                  + Add Page
                </button>
              </div>
            </div>

            {showPageForm && (
              <div className="bg-gray-800 rounded-xl p-4 mb-4 border border-gray-700 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Page Name *</label>
                    <input value={pageForm.page_name} onChange={e => setPageForm({...pageForm, page_name: e.target.value})}
                      className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500"
                      placeholder="Homepage" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Page Type</label>
                    <select value={pageForm.page_type} onChange={e => setPageForm({...pageForm, page_type: e.target.value})}
                      className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none">
                      {PAGE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">URL Slug</label>
                    <input value={pageForm.slug} onChange={e => setPageForm({...pageForm, slug: e.target.value})}
                      className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500"
                      placeholder="homepage" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Assigned To</label>
                    <select value={pageForm.assigned_to} onChange={e => setPageForm({...pageForm, assigned_to: e.target.value})}
                      className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none">
                      <option value="">Unassigned</option>
                      {members.map(m => <option key={m.id} value={m.id}>{m.full_name || m.email}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-gray-400 mb-1">Figma Frame URL</label>
                    <input value={pageForm.figma_frame_url} onChange={e => setPageForm({...pageForm, figma_frame_url: e.target.value})}
                      className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500"
                      placeholder="https://figma.com/file/.../...?node-id=..." />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-xs text-gray-400 mb-1">Content Brief</label>
                    <textarea value={pageForm.content} onChange={e => setPageForm({...pageForm, content: e.target.value})}
                      className="w-full bg-gray-700 text-white rounded px-2 py-2 text-xs focus:outline-none resize-none" rows={2}
                      placeholder="What should this page contain, communicate, or achieve..." />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Meta Title</label>
                    <input value={pageForm.meta_title} onChange={e => setPageForm({...pageForm, meta_title: e.target.value})}
                      className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Meta Description</label>
                    <input value={pageForm.meta_description} onChange={e => setPageForm({...pageForm, meta_description: e.target.value})}
                      className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={addPage} className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-4 py-1.5 rounded">Add Page</button>
                  <button onClick={() => setShowPageForm(false)} className="text-gray-400 text-xs hover:text-white px-3">Cancel</button>
                </div>
              </div>
            )}

            <div className="space-y-3">
              {pages.map(page => (
                <div key={page.id} className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                  {editingPage === page.id ? (
                    /* EDIT MODE */
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-white">{page.page_name}</p>
                        <div className="flex gap-2">
                          <button onClick={savePageEdit}
                            className="bg-green-600 hover:bg-green-700 text-white text-xs px-3 py-1 rounded">Save</button>
                          <button onClick={() => setEditingPage(null)}
                            className="text-gray-400 text-xs hover:text-white">Cancel</button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">Content Brief</label>
                          <textarea value={editForm.content || ''} onChange={e => setEditForm({...editForm, content: e.target.value})}
                            className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none resize-none" rows={3}/>
                        </div>
                        <div className="space-y-2">
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">Meta Title</label>
                            <input value={editForm.meta_title || ''} onChange={e => setEditForm({...editForm, meta_title: e.target.value})}
                              className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none"/>
                          </div>
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">Meta Description</label>
                            <input value={editForm.meta_description || ''} onChange={e => setEditForm({...editForm, meta_description: e.target.value})}
                              className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none"/>
                          </div>
                          <div>
                            <label className="block text-xs text-gray-400 mb-1">Figma Frame URL</label>
                            <input value={editForm.figma_frame_url || ''} onChange={e => setEditForm({...editForm, figma_frame_url: e.target.value})}
                              className="w-full bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none"/>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* VIEW MODE */
                    <div>
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-semibold text-white">{page.page_name}</h4>
                            <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded capitalize">{page.page_type}</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[page.status]}`}>{page.status}</span>
                          </div>
                          {page.slug && <p className="text-xs text-gray-500 mt-0.5">/{page.slug}</p>}
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          {/* Edit button */}
                          <button onClick={() => {
                            setEditingPage(page.id)
                            setEditForm({
                              content: page.content,
                              meta_title: page.meta_title,
                              meta_description: page.meta_description,
                              figma_frame_url: page.figma_frame_url,
                            })
                          }} className="bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs px-3 py-1.5 rounded-lg">
                            ✏️ Edit
                          </button>
                          {/* Generate / Regenerate */}
                          <button onClick={() => generateElementorPage(page)}
                            disabled={generatingPage === page.id}
                            className={`disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded-lg transition-colors ${page.elementor_json ? 'bg-gray-600 hover:bg-gray-500' : 'bg-blue-600 hover:bg-blue-700'}`}>
                            {generatingPage === page.id ? '⏳ Generating...' : page.elementor_json ? '🔄 Regenerate' : '🤖 Generate'}
                          </button>
                          {/* Push / Re-push */}
                          {page.elementor_json && (
                            <button onClick={() => pushToWordPress(page)}
                              disabled={pushingPage === page.id}
                              className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded-lg transition-colors">
                              {pushingPage === page.id ? '⏳ Pushing...' : page.wp_page_id ? '🔄 Re-push to WP' : '🚀 Push to WP'}
                            </button>
                          )}
                          {page.wp_page_url && (
                            <a href={page.wp_page_url} target="_blank" rel="noopener noreferrer"
                              className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-3 py-1.5 rounded-lg">↗ View</a>
                          )}
                          {/* WP Admin edit link */}
                          {page.wp_page_id && selectedSite && (
                            <a href={`${selectedSite.site_url}/wp-admin/post.php?post=${page.wp_page_id}&action=elementor`}
                              target="_blank" rel="noopener noreferrer"
                              className="bg-orange-600 hover:bg-orange-700 text-white text-xs px-3 py-1.5 rounded-lg">
                              🎨 Elementor
                            </a>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className={page.figma_frame_url ? 'text-green-400' : 'text-gray-600'}>
                            {page.figma_frame_url ? '✓' : '○'}
                          </span>
                          <span className="text-gray-500">Figma</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className={page.elementor_json ? 'text-green-400' : 'text-gray-600'}>
                            {page.elementor_json ? '✓' : '○'}
                          </span>
                          <span className="text-gray-500">Elementor JSON</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className={page.wp_page_id ? 'text-green-400' : 'text-gray-600'}>
                            {page.wp_page_id ? '✓' : '○'}
                          </span>
                          <span className="text-gray-500">
                            {page.wp_page_id ? `WP #${page.wp_page_id}` : 'Not in WP'}
                          </span>
                        </div>
                      </div>

                      {page.content && (
                        <p className="text-xs text-gray-500 mt-2 line-clamp-1">{page.content}</p>
                      )}
                      {page.pushed_at && (
                        <p className="text-xs text-gray-600 mt-1">Last pushed: {new Date(page.pushed_at).toLocaleString()}</p>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {pages.length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  <p className="text-4xl mb-3">📄</p>
                  <p className="text-sm">No pages yet</p>
                  <p className="text-xs mt-1">Add pages to start generating Elementor layouts</p>
                </div>
              )}
            </div>

            {/* SYNC MODAL */}
            {showSyncModal && (
              <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
                <div className="bg-gray-800 rounded-2xl w-full max-w-2xl border border-gray-700 flex flex-col"
                  style={{ maxHeight: '80vh' }}>
                  {/* Header */}
                  <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
                    <div>
                      <h3 className="text-base font-bold text-white">Import from WordPress</h3>
                      <p className="text-xs text-gray-400 mt-0.5">{selectedSite?.site_name} · {selectedSite?.site_url}</p>
                    </div>
                    <button onClick={() => setShowSyncModal(false)}
                      className="text-gray-400 hover:text-white text-lg">✕</button>
                  </div>

                  {/* Filter + select all */}
                  {wpLivePages.length > 0 && (
                    <div className="px-6 py-3 border-b border-gray-700 flex items-center gap-3">
                      <div className="flex gap-1 bg-gray-700 rounded-lg p-1">
                        {['all', 'publish', 'draft'].map(f => (
                          <button key={f} onClick={() => setImportFilter(f)}
                            className={`px-3 py-1 text-xs rounded-md capitalize transition-colors ${importFilter === f ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}>
                            {f}
                          </button>
                        ))}
                      </div>
                      <button
                        onClick={() => {
                          const filtered = wpLivePages.filter(p => importFilter === 'all' || p.status === importFilter)
                          const filteredIds = filtered.map(p => p.id)
                          const alreadyImported = pages.map(p => p.wp_page_id).filter(Boolean)
                          const available = filteredIds.filter(id => !alreadyImported.includes(id))
                          setSelectedForImport(prev =>
                            prev.length === available.length ? [] : available
                          )
                        }}
                        className="text-xs text-purple-400 hover:text-purple-300">
                        {selectedForImport.length > 0 ? 'Deselect all' : 'Select all'}
                      </button>
                      <span className="text-xs text-gray-500 ml-auto">
                        {selectedForImport.length} selected
                      </span>
                    </div>
                  )}

                  {/* Content */}
                  <div className="flex-1 overflow-y-auto p-6">
                    {syncLoading && (
                      <div className="flex flex-col items-center justify-center py-12 text-gray-500">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mb-3" />
                        <p className="text-sm">Fetching pages from WordPress...</p>
                      </div>
                    )}

                    {syncError && (
                      <div className="bg-red-900/30 border border-red-700/50 rounded-xl p-4">
                        <p className="text-sm text-red-300">❌ {syncError}</p>
                        <p className="text-xs text-gray-400 mt-1">Make sure CORS is enabled and credentials are correct.</p>
                      </div>
                    )}

                    {!syncLoading && !syncError && wpLivePages.length > 0 && (() => {
                      const alreadyImported = pages.map(p => p.wp_page_id).filter(Boolean)
                      const filtered = wpLivePages.filter(p => importFilter === 'all' || p.status === importFilter)
                      return (
                        <div className="space-y-2">
                          {filtered.map(wpPage => {
                            const isImported = alreadyImported.includes(wpPage.id)
                            const isSelected = selectedForImport.includes(wpPage.id)
                            const yoast = wpPage.yoast_head_json || {}
                            return (
                              <div key={wpPage.id}
                                onClick={() => {
                                  if (isImported) return
                                  setSelectedForImport(prev =>
                                    prev.includes(wpPage.id)
                                      ? prev.filter(id => id !== wpPage.id)
                                      : [...prev, wpPage.id]
                                  )
                                }}
                                className={`rounded-xl p-4 border transition-all ${
                                  isImported
                                    ? 'border-gray-700 bg-gray-700/20 opacity-50 cursor-not-allowed'
                                    : isSelected
                                      ? 'border-purple-500 bg-purple-900/20 cursor-pointer'
                                      : 'border-gray-700 bg-gray-800 hover:border-gray-600 cursor-pointer'
                                }`}>
                                <div className="flex items-start gap-3">
                                  {/* Checkbox */}
                                  <div className={`w-4 h-4 rounded border flex-shrink-0 mt-0.5 flex items-center justify-center ${
                                    isImported ? 'bg-gray-600 border-gray-500' :
                                    isSelected ? 'bg-purple-600 border-purple-500' :
                                    'border-gray-600'
                                  }`}>
                                    {(isSelected || isImported) && (
                                      <span className="text-white text-xs">✓</span>
                                    )}
                                  </div>

                                  {/* Page info */}
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                      <p className="text-sm font-medium text-white truncate">
                                        {wpPage.title?.rendered || wpPage.slug}
                                      </p>
                                      <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${
                                        wpPage.status === 'publish' ? 'bg-green-900/50 text-green-300' : 'bg-gray-700 text-gray-400'
                                      }`}>
                                        {wpPage.status}
                                      </span>
                                      {isImported && (
                                        <span className="text-xs bg-blue-900/50 text-blue-300 px-1.5 py-0.5 rounded flex-shrink-0">
                                          Already imported
                                        </span>
                                      )}
                                    </div>

                                    <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-gray-500">
                                      <span>/{wpPage.slug}</span>
                                      <span>ID: {wpPage.id}</span>
                                      {wpPage.modified && (
                                        <span>Modified: {new Date(wpPage.modified).toLocaleDateString()}</span>
                                      )}
                                      {yoast.title && (
                                        <span className="truncate">SEO: {yoast.title}</span>
                                      )}
                                    </div>

                                    {yoast.description && (
                                      <p className="text-xs text-gray-600 mt-1 line-clamp-1">{yoast.description}</p>
                                    )}
                                  </div>

                                  {/* Live link */}
                                  <a href={wpPage.link} target="_blank" rel="noopener noreferrer"
                                    onClick={e => e.stopPropagation()}
                                    className="text-xs text-blue-400 hover:text-blue-300 flex-shrink-0">↗</a>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      )
                    })()}

                    {!syncLoading && !syncError && wpLivePages.length === 0 && (
                      <div className="text-center py-12 text-gray-500">
                        <p className="text-4xl mb-3">📄</p>
                        <p className="text-sm">No pages found</p>
                      </div>
                    )}
                  </div>

                  {/* Footer */}
                  <div className="px-6 py-4 border-t border-gray-700 flex items-center justify-between">
                    <p className="text-xs text-gray-500">
                      {wpLivePages.length} pages found · {pages.filter(p => p.wp_page_id).length} already imported
                    </p>
                    <div className="flex gap-3">
                      <button onClick={() => setShowSyncModal(false)}
                        className="text-gray-400 text-sm hover:text-white px-3">Cancel</button>
                      <button
                        onClick={importSelectedPages}
                        disabled={!selectedForImport.length || importing}
                        className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium">
                        {importing ? '⏳ Importing...' : `Import ${selectedForImport.length} pages`}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* GENERATOR LOG TAB */}
        {activeTab === 'generator' && (
          <div>
            <h3 className="text-sm font-semibold text-gray-300 mb-4">Generation Log</h3>
            {generationLog.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <p className="text-4xl mb-3">🤖</p>
                <p className="text-sm">No generation running</p>
                <p className="text-xs mt-1">Go to Pages tab and click Generate on a page</p>
              </div>
            ) : (
              <div className="bg-gray-900 rounded-xl p-4 border border-gray-800 font-mono text-xs space-y-1 max-h-96 overflow-y-auto">
                {generationLog.map((log, i) => (
                  <div key={i} className={`flex items-start gap-2 ${
                    log.type === 'error' ? 'text-red-400' :
                    log.type === 'success' ? 'text-green-400' :
                    log.type === 'warning' ? 'text-yellow-400' :
                    'text-gray-300'
                  }`}>
                    <span className="text-gray-600 flex-shrink-0">{log.ts}</span>
                    <span>{log.message}</span>
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
