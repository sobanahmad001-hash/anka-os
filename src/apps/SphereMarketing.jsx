import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'
import MarketingFiles from '../components/MarketingFiles.jsx'

const PLATFORMS = ['Instagram', 'TikTok', 'Facebook', 'LinkedIn', 'YouTube']
const POST_TYPES = ['static', 'reel', 'carousel', 'story', 'video', 'live']
const CONTENT_STATUSES = ['idea', 'brief', 'drafting', 'review', 'approved', 'published']
const CONTENT_STATUS_COLORS = {
  idea: 'bg-gray-700 text-gray-300',
  brief: 'bg-blue-900/50 text-blue-300',
  drafting: 'bg-yellow-900/50 text-yellow-300',
  review: 'bg-orange-900/50 text-orange-300',
  approved: 'bg-purple-900/50 text-purple-300',
  published: 'bg-green-900/50 text-green-300',
}
const CAMPAIGN_STATUS_COLORS = {
  draft: 'bg-gray-700 text-gray-300',
  scheduled: 'bg-blue-900/50 text-blue-300',
  live: 'bg-green-900/50 text-green-300',
  paused: 'bg-yellow-900/50 text-yellow-300',
  ended: 'bg-gray-700 text-gray-400',
}

const SCOPE_CHANNELS = {
  seo: {
    label: 'SEO', color: 'teal',
    children: [
      { key: 'seo_onpage', label: 'On-page' },
      { key: 'seo_technical', label: 'Technical' },
      { key: 'seo_offpage', label: 'Off-page' },
    ]
  },
  content: {
    label: 'Content', color: 'amber',
    children: [
      { key: 'content_blogs', label: 'Blogs' },
      { key: 'content_copy', label: 'Copy' },
      { key: 'content_email', label: 'Email' },
    ]
  },
  social: {
    label: 'Social organic', color: 'coral',
    children: [
      { key: 'social_instagram', label: 'Instagram' },
      { key: 'social_tiktok', label: 'TikTok' },
      { key: 'social_facebook', label: 'Facebook' },
      { key: 'social_linkedin', label: 'LinkedIn' },
      { key: 'social_youtube', label: 'YouTube' },
    ]
  },
  paid: {
    label: 'Paid', color: 'blue',
    children: [
      { key: 'paid_google', label: 'Google Ads' },
      { key: 'paid_meta', label: 'Meta Ads' },
      { key: 'paid_influencers', label: 'Influencers' },
      { key: 'paid_sponsorships', label: 'Sponsorships' },
    ]
  },
  analytics: {
    label: 'Analytics', color: 'green',
    children: [
      { key: 'analytics_gsc', label: 'Search Console' },
      { key: 'analytics_ga4', label: 'GA4' },
    ]
  }
}

const COLOR_MAP = {
  teal: { bg: 'bg-teal-900/30', border: 'border-teal-700/50', text: 'text-teal-300', dot: 'bg-teal-500' },
  amber: { bg: 'bg-amber-900/30', border: 'border-amber-700/50', text: 'text-amber-300', dot: 'bg-amber-500' },
  coral: { bg: 'bg-orange-900/30', border: 'border-orange-700/50', text: 'text-orange-300', dot: 'bg-orange-500' },
  blue: { bg: 'bg-blue-900/30', border: 'border-blue-700/50', text: 'text-blue-300', dot: 'bg-blue-500' },
  green: { bg: 'bg-green-900/30', border: 'border-green-700/50', text: 'text-green-300', dot: 'bg-green-500' },
}

export default function SphereMarketing() {
  const { user, profile } = useAuth()
  const [projects, setProjects] = useState([])
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [selectedProject, setSelectedProject] = useState(null)
  const [activeTab, setActiveTab] = useState('overview')
  const [loading, setLoading] = useState(false)

  // Data
  const [scope, setScope] = useState({})
  const [seoPages, setSeoPages] = useState([])
  const [content, setContent] = useState([])
  const [socialPosts, setSocialPosts] = useState([])
  const [campaigns, setCampaigns] = useState([])
  const [snapshots, setSnapshots] = useState([])
  const [emails, setEmails] = useState([])

  // Forms
  const [showNewSEO, setShowNewSEO] = useState(false)
  const [showNewContent, setShowNewContent] = useState(false)
  const [showNewPost, setShowNewPost] = useState(false)
  const [showNewCampaign, setShowNewCampaign] = useState(false)
  const [showNewSnapshot, setShowNewSnapshot] = useState(false)
  const [showNewEmail, setShowNewEmail] = useState(false)
  const [showStrategy, setShowStrategy] = useState(false)
  const [strategy, setStrategy] = useState({ doc: null, content: '' })
  const [savingStrategy, setSavingStrategy] = useState(false)
  const [editingStrategy, setEditingStrategy] = useState(false)

  const [newSEO, setNewSEO] = useState({ page_name: '', url: '', page_type: 'service_page', primary_keyword: '', primary_kw_volume: '', primary_kw_difficulty: '', primary_kw_position: '', secondary_keywords: '', meta_title: '', meta_description: '', seo_score: '', content_status: 'not_started' })
  const [newContent, setNewContent] = useState({ content_type: 'blog', title: '', primary_keyword: '', assigned_writer: '', status: 'idea', draft_link: '', published_link: '', seo_score: '', publish_date: '' })
  const [newPost, setNewPost] = useState({ platform: 'Instagram', post_type: 'static', title: '', content_brief: '', caption: '', hashtags: '', scheduled_date: '', status: 'idea', media_link: '' })
  const [newCampaign, setNewCampaign] = useState({ platform: 'Google Ads', campaign_name: '', campaign_type: 'search', status: 'draft', start_date: '', end_date: '', budget_daily: '', budget_total: '' })
  const [newSnapshot, setNewSnapshot] = useState({ snapshot_date: new Date().toISOString().split('T')[0], source: 'manual', gsc_clicks: '', gsc_impressions: '', gsc_ctr: '', gsc_avg_position: '', ga4_sessions: '', ga4_users: '', ga4_bounce_rate: '', ga4_conversions: '', notes: '' })
  const [newEmail, setNewEmail] = useState({ email_type: 'service', subject_line: '', target_segment: '', key_hook: '', send_date: '', status: 'planned', goal: '' })

  // Filters
  const [socialFilter, setSocialFilter] = useState('all')
  const [calendarView, setCalendarView] = useState('unified')
  const [contentFilter, setContentFilter] = useState('all')

  // AI
  const [aiGenerating, setAiGenerating] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiOutput, setAiOutput] = useState('')

  // CSV import
  const [showCSVImport, setShowCSVImport] = useState(false)
  const [csvText, setCsvText] = useState('')
  const [csvImporting, setCsvImporting] = useState(false)
  const [csvResult, setCsvResult] = useState(null)
  const [csvType, setCsvType] = useState('seo')

  useEffect(() => { fetchProjects() }, [])
  useEffect(() => {
    if (selectedProjectId) {
      const p = projects.find(p => p.id === selectedProjectId)
      setSelectedProject(p)
      fetchAll()
    }
  }, [selectedProjectId])

  async function fetchProjects() {
    const { data } = await supabase.from('as_projects')
      .select('id, name, as_clients(name)').order('name')
    setProjects(data || [])
  }

  async function fetchAll() {
    setLoading(true)
    const [scopeRes, seoRes, contentRes, socialRes, campaignRes, snapshotRes, emailRes, strategyRes] = await Promise.all([
      supabase.from('as_marketing_scope').select('*').eq('project_id', selectedProjectId).single(),
      supabase.from('as_seo_tracker').select('*').eq('project_id', selectedProjectId).order('created_at'),
      supabase.from('as_content_tracker').select('*').eq('project_id', selectedProjectId).order('created_at', { ascending: false }),
      supabase.from('as_social_calendar').select('*').eq('project_id', selectedProjectId).order('scheduled_date'),
      supabase.from('as_paid_campaigns').select('*').eq('project_id', selectedProjectId).order('created_at', { ascending: false }),
      supabase.from('as_analytics_snapshots').select('*').eq('project_id', selectedProjectId).order('snapshot_date', { ascending: false }).limit(12),
      supabase.from('as_email_calendar').select('*').eq('project_id', selectedProjectId).order('send_date'),
      supabase.from('as_project_documents').select('*').eq('project_id', selectedProjectId).eq('doc_type', 'marketing_strategy').single()
    ])
    setScope(scopeRes.data || {})
    setSeoPages(seoRes.data || [])
    setContent(contentRes.data || [])
    setSocialPosts(socialRes.data || [])
    setCampaigns(campaignRes.data || [])
    setSnapshots(snapshotRes.data || [])
    setEmails(emailRes.data || [])
    if (strategyRes.data) {
      setStrategy({ doc: strategyRes.data, content: strategyRes.data.content || '' })
    }
    setLoading(false)
  }

  async function saveScope(updates) {
    const newScope = { ...scope, ...updates }
    setScope(newScope)
    if (scope.id) {
      await supabase.from('as_marketing_scope').update({ ...updates, updated_by: user?.id, updated_at: new Date().toISOString() }).eq('id', scope.id)
    } else {
      const { data } = await supabase.from('as_marketing_scope').insert({ project_id: selectedProjectId, ...newScope, updated_by: user?.id }).select().single()
      if (data) setScope(data)
    }
  }

  async function saveStrategy() {
    setSavingStrategy(true)
    if (strategy.doc) {
      await supabase.from('as_project_documents').update({
        content: strategy.content,
        version: (strategy.doc.version || 1) + 1,
        updated_by: user?.id,
        updated_at: new Date().toISOString()
      }).eq('id', strategy.doc.id)
    } else {
      const { data } = await supabase.from('as_project_documents').insert({
        project_id: selectedProjectId,
        doc_type: 'marketing_strategy',
        title: 'Marketing Strategy',
        content: strategy.content,
        updated_by: user?.id
      }).select().single()
      if (data) setStrategy(s => ({ ...s, doc: data }))
    }
    setEditingStrategy(false)
    setSavingStrategy(false)
  }

  async function addSEOPage() {
    if (!newSEO.page_name) return
    await supabase.from('as_seo_tracker').insert({ ...newSEO, project_id: selectedProjectId, primary_kw_volume: newSEO.primary_kw_volume ? parseInt(newSEO.primary_kw_volume) : null, primary_kw_difficulty: newSEO.primary_kw_difficulty ? parseInt(newSEO.primary_kw_difficulty) : null, primary_kw_position: newSEO.primary_kw_position ? parseInt(newSEO.primary_kw_position) : null, seo_score: newSEO.seo_score ? parseInt(newSEO.seo_score) : null })
    setShowNewSEO(false)
    setNewSEO({ page_name: '', url: '', page_type: 'service_page', primary_keyword: '', primary_kw_volume: '', primary_kw_difficulty: '', primary_kw_position: '', secondary_keywords: '', meta_title: '', meta_description: '', seo_score: '', content_status: 'not_started' })
    fetchAll()
  }

  async function updateSEOPage(id, field, value) {
    await supabase.from('as_seo_tracker').update({ [field]: value, last_updated: new Date().toISOString() }).eq('id', id)
    setSeoPages(seoPages.map(p => p.id === id ? { ...p, [field]: value } : p))
  }

  async function addContent() {
    if (!newContent.title) return
    await supabase.from('as_content_tracker').insert({ ...newContent, project_id: selectedProjectId, seo_score: newContent.seo_score ? parseInt(newContent.seo_score) : null })
    setShowNewContent(false)
    setNewContent({ content_type: 'blog', title: '', primary_keyword: '', assigned_writer: '', status: 'idea', draft_link: '', published_link: '', seo_score: '', publish_date: '' })
    fetchAll()
  }

  async function updateContent(id, field, value) {
    await supabase.from('as_content_tracker').update({ [field]: value, updated_at: new Date().toISOString() }).eq('id', id)
    setContent(content.map(c => c.id === id ? { ...c, [field]: value } : c))
  }

  async function addPost() {
    if (!newPost.title) return
    await supabase.from('as_social_calendar').insert({ ...newPost, project_id: selectedProjectId })
    setShowNewPost(false)
    setNewPost({ platform: 'Instagram', post_type: 'static', title: '', content_brief: '', caption: '', hashtags: '', scheduled_date: '', status: 'idea', media_link: '' })
    fetchAll()
  }

  async function updatePost(id, field, value) {
    await supabase.from('as_social_calendar').update({ [field]: value }).eq('id', id)
    setSocialPosts(socialPosts.map(p => p.id === id ? { ...p, [field]: value } : p))
  }

  async function addCampaign() {
    if (!newCampaign.campaign_name) return
    await supabase.from('as_paid_campaigns').insert({ ...newCampaign, project_id: selectedProjectId, budget_daily: newCampaign.budget_daily ? parseFloat(newCampaign.budget_daily) : null, budget_total: newCampaign.budget_total ? parseFloat(newCampaign.budget_total) : null })
    setShowNewCampaign(false)
    setNewCampaign({ platform: 'Google Ads', campaign_name: '', campaign_type: 'search', status: 'draft', start_date: '', end_date: '', budget_daily: '', budget_total: '' })
    fetchAll()
  }

  async function updateCampaign(id, updates) {
    await supabase.from('as_paid_campaigns').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id)
    setCampaigns(campaigns.map(c => c.id === id ? { ...c, ...updates } : c))
  }

  async function addSnapshot() {
    if (!newSnapshot.snapshot_date) return
    await supabase.from('as_analytics_snapshots').insert({
      ...newSnapshot, project_id: selectedProjectId,
      gsc_clicks: newSnapshot.gsc_clicks ? parseInt(newSnapshot.gsc_clicks) : null,
      gsc_impressions: newSnapshot.gsc_impressions ? parseInt(newSnapshot.gsc_impressions) : null,
      gsc_ctr: newSnapshot.gsc_ctr ? parseFloat(newSnapshot.gsc_ctr) : null,
      gsc_avg_position: newSnapshot.gsc_avg_position ? parseFloat(newSnapshot.gsc_avg_position) : null,
      ga4_sessions: newSnapshot.ga4_sessions ? parseInt(newSnapshot.ga4_sessions) : null,
      ga4_users: newSnapshot.ga4_users ? parseInt(newSnapshot.ga4_users) : null,
      ga4_bounce_rate: newSnapshot.ga4_bounce_rate ? parseFloat(newSnapshot.ga4_bounce_rate) : null,
      ga4_conversions: newSnapshot.ga4_conversions ? parseInt(newSnapshot.ga4_conversions) : null,
    })
    setShowNewSnapshot(false)
    setNewSnapshot({ snapshot_date: new Date().toISOString().split('T')[0], source: 'manual', gsc_clicks: '', gsc_impressions: '', gsc_ctr: '', gsc_avg_position: '', ga4_sessions: '', ga4_users: '', ga4_bounce_rate: '', ga4_conversions: '', notes: '' })
    fetchAll()
  }

  async function addEmail() {
    if (!newEmail.subject_line) return
    await supabase.from('as_email_calendar').insert({ ...newEmail, project_id: selectedProjectId })
    setShowNewEmail(false)
    setNewEmail({ email_type: 'service', subject_line: '', target_segment: '', key_hook: '', send_date: '', status: 'planned', goal: '' })
    fetchAll()
  }

  async function generateAIContent() {
    if (!aiPrompt.trim() || !selectedProject) return
    setAiGenerating(true)
    setAiOutput('')
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': import.meta.env.VITE_ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2000,
          system: `You are a digital marketing expert. You create high-quality marketing content for ${selectedProject.name}. 
Active channels: ${Object.entries(scope).filter(([k,v]) => v === true).map(([k]) => k.replace(/_/g, ' ')).join(', ')}.
Be specific, actionable, and tailored to the brand.`,
          messages: [{ role: 'user', content: aiPrompt }]
        })
      })
      const data = await response.json()
      setAiOutput(data.content?.[0]?.text || 'No output')
    } catch (err) {
      setAiOutput('Error: ' + err.message)
    }
    setAiGenerating(false)
  }

  async function importCSV(type) {
    if (!csvText.trim() || !selectedProjectId) return
    setCsvImporting(true)
    setCsvResult(null)
    try {
      const lines = csvText.trim().split('\n').filter(l => l.trim())
      if (lines.length < 2) throw new Error('CSV needs at least a header row and one data row')

      const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, '').replace(/\s+/g, '_'))

      const rows = lines.slice(1).map(line => {
        const values = []
        let current = ''
        let inQuotes = false
        for (const char of line) {
          if (char === '"') { inQuotes = !inQuotes }
          else if (char === ',' && !inQuotes) { values.push(current.trim()); current = '' }
          else { current += char }
        }
        values.push(current.trim())
        return headers.reduce((obj, header, i) => {
          obj[header] = (values[i] || '').replace(/^["']|["']$/g, '').trim()
          return obj
        }, {})
      }).filter(row => Object.values(row).some(v => v))

      if (!rows.length) throw new Error('No valid rows found')

      let inserted = 0
      let skipped = 0

      if (type === 'seo') {
        const inserts = rows.map(row => ({
          project_id: selectedProjectId,
          page_name: row.page_name || row.page || row.name || '',
          url: row.url || row.full_url || row.slug || '',
          page_type: row.page_type || row.type || 'service_page',
          primary_keyword: row.primary_keyword || row.keyword || '',
          primary_kw_volume: parseInt(row.primary_kw_volume || row.search_volume || row.sv || '0') || null,
          primary_kw_difficulty: parseInt(row.primary_kw_difficulty || row.kd || row.difficulty || '0') || null,
          primary_kw_position: parseInt(row.primary_kw_position || row.position || row.rank || '0') || null,
          meta_title: row.meta_title || '',
          meta_description: row.meta_description || '',
          seo_score: parseInt(row.seo_score || '0') || null,
          content_status: row.content_status || row.status || 'not_started',
        })).filter(r => r.page_name)

        if (!inserts.length) throw new Error('No rows with page_name found')

        const { error } = await supabase.from('as_seo_tracker').insert(inserts)
        if (error) throw error
        inserted = inserts.length
        skipped = rows.length - inserts.length

      } else if (type === 'content') {
        const inserts = rows.map(row => ({
          project_id: selectedProjectId,
          title: row.title || row.name || '',
          content_type: row.content_type || row.type || 'blog',
          primary_keyword: row.primary_keyword || row.keyword || '',
          assigned_writer: row.assigned_writer || row.writer || '',
          status: row.status || 'idea',
          draft_link: row.draft_link || row.draft || '',
          published_link: row.published_link || row.url || row.link || '',
          seo_score: parseInt(row.seo_score || '0') || null,
          publish_date: row.publish_date || row.date || null,
        })).filter(r => r.title)

        if (!inserts.length) throw new Error('No rows with title found')

        const { error } = await supabase.from('as_content_tracker').insert(inserts)
        if (error) throw error
        inserted = inserts.length
        skipped = rows.length - inserts.length
      }

      setCsvResult({
        success: true,
        message: `✅ Imported ${inserted} rows successfully${skipped ? ` · ${skipped} rows skipped (missing required fields)` : ''}`
      })
      setCsvText('')
      fetchAll()

    } catch (err) {
      setCsvResult({ success: false, message: `❌ ${err.message}` })
    }
    setCsvImporting(false)
  }

  // Analytics helpers
  const latestSnapshot = snapshots[0]
  const prevSnapshot = snapshots[1]
  function delta(curr, prev) {
    if (!curr || !prev) return null
    const d = curr - prev
    return { value: Math.abs(d), up: d >= 0 }
  }

  // Scope helpers
  function activeChannelCount() {
    return Object.values(scope).filter(v => v === true).length
  }

  // All calendar items unified
  const allCalendarItems = [
    ...socialPosts.map(p => ({ ...p, itemType: 'social', date: p.scheduled_date })),
    ...emails.map(e => ({ ...e, itemType: 'email', date: e.send_date })),
    ...content.filter(c => c.publish_date).map(c => ({ ...c, itemType: 'content', date: c.publish_date })),
  ].filter(i => i.date).sort((a, b) => new Date(a.date) - new Date(b.date))

  if (loading && selectedProjectId) return (
    <div className="flex items-center justify-center h-full bg-gray-950">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500" />
    </div>
  )

  return (
    <div className="flex flex-col h-full bg-gray-950 text-white">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">Marketing</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {selectedProjectId ? `${activeChannelCount()} active channels` : 'Select a project'}
          </p>
        </div>
        <select value={selectedProjectId} onChange={e => setSelectedProjectId(e.target.value)}
          className="bg-gray-800 text-gray-300 text-xs rounded-lg px-3 py-2 border border-gray-700 focus:outline-none">
          <option value="">Select project</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}{p.as_clients?.name ? ` · ${p.as_clients.name}` : ''}</option>)}
        </select>
      </div>

      {!selectedProjectId ? (
        <div className="flex-1 flex items-center justify-center text-gray-500">
          <div className="text-center">
            <p className="text-5xl mb-4">📊</p>
            <p className="text-lg font-medium text-gray-400">Select a project to open Marketing</p>
          </div>
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="flex gap-1 px-6 py-3 border-b border-gray-800 overflow-x-auto">
            {[
              { id: 'overview', label: '📊 Overview' },
              { id: 'seo', label: '🔍 SEO' },
              { id: 'content', label: '📝 Content' },
              { id: 'social', label: '📱 Social' },
              { id: 'paid', label: '💰 Paid' },
              { id: 'calendar', label: '📅 Calendar' },
              { id: 'scope', label: '⚙️ Scope' },
              { id: 'files', label: '📎 Files' },
            ].map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition-colors ${activeTab === tab.id ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}>
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-6">

            {/* OVERVIEW */}
            {activeTab === 'overview' && (
              <div className="space-y-5">
                {/* Analytics snapshot */}
                <div className="grid grid-cols-4 gap-4">
                  {[
                    { label: 'Clicks', value: latestSnapshot?.gsc_clicks, prev: prevSnapshot?.gsc_clicks, format: n => n?.toLocaleString() || '—', source: 'GSC' },
                    { label: 'Impressions', value: latestSnapshot?.gsc_impressions, prev: prevSnapshot?.gsc_impressions, format: n => n?.toLocaleString() || '—', source: 'GSC' },
                    { label: 'Avg Position', value: latestSnapshot?.gsc_avg_position, prev: prevSnapshot?.gsc_avg_position, format: n => n ? `#${n.toFixed(1)}` : '—', source: 'GSC', invertDelta: true },
                    { label: 'Sessions', value: latestSnapshot?.ga4_sessions, prev: prevSnapshot?.ga4_sessions, format: n => n?.toLocaleString() || '—', source: 'GA4' },
                  ].map(stat => {
                    const d = delta(stat.value, stat.prev)
                    const up = stat.invertDelta ? (d && !d.up) : (d && d.up)
                    return (
                      <div key={stat.label} className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                        <div className="flex items-center justify-between mb-1">
                          <p className="text-xs text-gray-400">{stat.label}</p>
                          <span className="text-xs bg-gray-700 text-gray-400 px-1.5 py-0.5 rounded">{stat.source}</span>
                        </div>
                        <p className="text-2xl font-bold text-white">{stat.format(stat.value)}</p>
                        {d && (
                          <p className={`text-xs mt-1 ${up ? 'text-green-400' : 'text-red-400'}`}>
                            {up ? '↑' : '↓'} {d.value.toLocaleString()} vs prev
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>

                {/* Add snapshot button */}
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-400">
                    {snapshots.length} snapshots recorded
                    {latestSnapshot && ` · Last: ${new Date(latestSnapshot.snapshot_date).toLocaleDateString()}`}
                  </p>
                  <button onClick={() => setShowNewSnapshot(true)} className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg border border-gray-700">+ Add Weekly Snapshot</button>
                </div>

                {/* Snapshot form */}
                {showNewSnapshot && (
                  <div className="bg-gray-800 rounded-xl p-5 border border-gray-700 space-y-4">
                    <h4 className="text-sm font-semibold text-white">Weekly Analytics Snapshot</h4>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-gray-400 mb-2 font-medium">Google Search Console</p>
                        <div className="space-y-2">
                          {[['gsc_clicks','Clicks'],['gsc_impressions','Impressions'],['gsc_ctr','CTR %'],['gsc_avg_position','Avg Position']].map(([key,label]) => (
                            <div key={key} className="flex items-center gap-2">
                              <label className="text-xs text-gray-500 w-24 flex-shrink-0">{label}</label>
                              <input value={newSnapshot[key]} onChange={e => setNewSnapshot({...newSnapshot, [key]: e.target.value})}
                                className="flex-1 bg-gray-700 text-white rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500" />
                            </div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p className="text-xs text-gray-400 mb-2 font-medium">Google Analytics 4</p>
                        <div className="space-y-2">
                          {[['ga4_sessions','Sessions'],['ga4_users','Users'],['ga4_bounce_rate','Bounce Rate %'],['ga4_conversions','Conversions']].map(([key,label]) => (
                            <div key={key} className="flex items-center gap-2">
                              <label className="text-xs text-gray-500 w-24 flex-shrink-0">{label}</label>
                              <input value={newSnapshot[key]} onChange={e => setNewSnapshot({...newSnapshot, [key]: e.target.value})}
                                className="flex-1 bg-gray-700 text-white rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500" />
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <input type="date" value={newSnapshot.snapshot_date} onChange={e => setNewSnapshot({...newSnapshot, snapshot_date: e.target.value})}
                        className="bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none" />
                      <button onClick={addSnapshot} className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-4 py-1.5 rounded">Save Snapshot</button>
                      <button onClick={() => setShowNewSnapshot(false)} className="text-gray-400 text-xs hover:text-white">Cancel</button>
                    </div>
                  </div>
                )}

                {/* Active channels summary */}
                <div className="grid grid-cols-5 gap-3">
                  {Object.entries(SCOPE_CHANNELS).map(([key, channel]) => {
                    const c = COLOR_MAP[channel.color]
                    const active = channel.children.filter(ch => scope[ch.key]).length
                    const total = channel.children.length
                    return (
                      <div key={key} className={`rounded-xl p-3 border ${c.bg} ${c.border}`}>
                        <p className={`text-xs font-semibold ${c.text} mb-1`}>{channel.label}</p>
                        <p className="text-lg font-bold text-white">{active}/{total}</p>
                        <p className="text-xs text-gray-500">active</p>
                      </div>
                    )
                  })}
                </div>

                {/* Strategy document */}
                <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-white">📄 Marketing Strategy Document</h3>
                    <button onClick={() => setEditingStrategy(!editingStrategy)}
                      className="text-xs text-purple-400 hover:text-purple-300">
                      {editingStrategy ? 'Cancel' : strategy.doc ? 'Edit' : '+ Create'}
                    </button>
                  </div>
                  {editingStrategy ? (
                    <div className="space-y-3">
                      <textarea value={strategy.content} onChange={e => setStrategy(s => ({ ...s, content: e.target.value }))}
                        className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-purple-500 resize-none" rows={10}
                        placeholder="Write the full marketing strategy for this project..." />
                      <div className="flex gap-2">
                        <button onClick={saveStrategy} disabled={savingStrategy}
                          className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-xs px-4 py-1.5 rounded">
                          {savingStrategy ? 'Saving...' : 'Save Strategy'}
                        </button>
                        <button onClick={generateAIContent} disabled={aiGenerating}
                          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs px-4 py-1.5 rounded">
                          {aiGenerating ? '⏳ Generating...' : '🤖 AI Draft'}
                        </button>
                      </div>
                    </div>
                  ) : strategy.doc ? (
                    <pre className="text-xs text-gray-300 whitespace-pre-wrap font-sans line-clamp-6">{strategy.content}</pre>
                  ) : (
                    <p className="text-xs text-gray-500 italic">No strategy document yet. Click Create to write one.</p>
                  )}
                </div>

                {/* AI Assistant */}
                <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
                  <h3 className="text-sm font-semibold text-white mb-3">🤖 AI Marketing Assistant</h3>
                  <div className="flex gap-2 mb-3 flex-wrap">
                    {[
                      'Write 3 Instagram captions for this week',
                      'Create a blog post brief for airport transfers',
                      'Suggest Google Ads keywords for limo service NYC',
                      'Draft an email subject line for event transportation',
                      'Write SEO meta description for homepage',
                    ].map(s => (
                      <button key={s} onClick={() => setAiPrompt(s)}
                        className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1.5 rounded-lg border border-gray-600">
                        {s}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input value={aiPrompt} onChange={e => setAiPrompt(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && generateAIContent()}
                      className="flex-1 bg-gray-700 text-white rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500 border border-gray-600"
                      placeholder="Ask the AI to create marketing content..." />
                    <button onClick={generateAIContent} disabled={aiGenerating || !aiPrompt.trim()}
                      className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-sm">
                      {aiGenerating ? '⏳' : '→'}
                    </button>
                  </div>
                  {aiOutput && (
                    <div className="mt-3 bg-gray-900 rounded-xl p-4 border border-gray-700">
                      <pre className="text-sm text-gray-200 whitespace-pre-wrap font-sans">{aiOutput}</pre>
                      <button onClick={() => navigator.clipboard.writeText(aiOutput)}
                        className="mt-2 text-xs text-blue-400 hover:text-blue-300">Copy</button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* SEO */}
            {activeTab === 'seo' && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-300">SEO Tracker ({seoPages.length} pages)</h3>
                    <div className="flex gap-3 mt-1 text-xs text-gray-500">
                      <span>On-page: <span className={scope.seo_onpage ? 'text-green-400' : 'text-gray-600'}>{scope.seo_onpage ? 'Active' : 'Off'}</span></span>
                      <span>Technical: <span className={scope.seo_technical ? 'text-green-400' : 'text-gray-600'}>{scope.seo_technical ? 'Active' : 'Off'}</span></span>
                      <span>Off-page: <span className={scope.seo_offpage ? 'text-green-400' : 'text-gray-600'}>{scope.seo_offpage ? 'Active' : 'Off'}</span></span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => { setShowCSVImport(!showCSVImport); setCsvType('seo') }}
                      className="bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs px-3 py-1.5 rounded-lg border border-gray-600">
                      ↑ Import CSV
                    </button>
                    <button onClick={() => setShowNewSEO(!showNewSEO)} className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-3 py-1.5 rounded-lg">+ Add Page</button>
                  </div>
                </div>

                {showCSVImport && (
                  <div className="bg-gray-800 rounded-xl p-5 border border-gray-700 mb-4 space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-white">CSV Import</h4>
                      <div className="flex gap-2">
                        <select value={csvType} onChange={e => setCsvType(e.target.value)}
                          className="bg-gray-700 text-white rounded px-2 py-1 text-xs focus:outline-none">
                          <option value="seo">SEO Pages</option>
                          <option value="content">Content</option>
                        </select>
                      </div>
                    </div>

                    {csvType === 'seo' && (
                      <div className="bg-gray-700/50 rounded-lg p-3 text-xs text-gray-400">
                        <p className="font-medium text-gray-300 mb-1">Expected columns (in any order):</p>
                        <p>page_name, url, page_type, primary_keyword, primary_kw_volume, primary_kw_difficulty, primary_kw_position, meta_title, meta_description, seo_score</p>
                        <p className="mt-1 text-gray-500">Only page_name is required. Extra columns are ignored.</p>
                      </div>
                    )}

                    {csvType === 'content' && (
                      <div className="bg-gray-700/50 rounded-lg p-3 text-xs text-gray-400">
                        <p className="font-medium text-gray-300 mb-1">Expected columns:</p>
                        <p>title, content_type, primary_keyword, assigned_writer, status, draft_link, published_link, seo_score, publish_date</p>
                        <p className="mt-1 text-gray-500">Only title is required.</p>
                      </div>
                    )}

                    <textarea value={csvText} onChange={e => setCsvText(e.target.value)}
                      className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-purple-500 resize-none" rows={8}
                      placeholder="Paste CSV content here — first row must be headers..." />

                    {csvResult && (
                      <div className={`rounded-lg p-3 text-xs ${csvResult.success ? 'bg-green-900/30 text-green-300 border border-green-700/50' : 'bg-red-900/30 text-red-300 border border-red-700/50'}`}>
                        {csvResult.message}
                      </div>
                    )}

                    <div className="flex gap-3">
                      <button onClick={() => importCSV(csvType)} disabled={csvImporting || !csvText.trim()}
                        className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs px-4 py-1.5 rounded">
                        {csvImporting ? '⏳ Importing...' : '↑ Import'}
                      </button>
                      <button onClick={() => { setShowCSVImport(false); setCsvText(''); setCsvResult(null) }}
                        className="text-gray-400 text-xs hover:text-white px-3">Cancel</button>
                    </div>
                  </div>
                )}

                {showNewSEO && (
                  <div className="bg-gray-800 rounded-xl p-4 mb-4 border border-gray-700 space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                      <input value={newSEO.page_name} onChange={e => setNewSEO({...newSEO, page_name: e.target.value})} placeholder="Page name *" className="bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500"/>
                      <input value={newSEO.url} onChange={e => setNewSEO({...newSEO, url: e.target.value})} placeholder="URL" className="bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500"/>
                      <input value={newSEO.primary_keyword} onChange={e => setNewSEO({...newSEO, primary_keyword: e.target.value})} placeholder="Primary keyword" className="bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500"/>
                      <input value={newSEO.primary_kw_volume} onChange={e => setNewSEO({...newSEO, primary_kw_volume: e.target.value})} placeholder="Search volume" className="bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none"/>
                      <input value={newSEO.primary_kw_difficulty} onChange={e => setNewSEO({...newSEO, primary_kw_difficulty: e.target.value})} placeholder="KD (0-100)" className="bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none"/>
                      <input value={newSEO.primary_kw_position} onChange={e => setNewSEO({...newSEO, primary_kw_position: e.target.value})} placeholder="Current position" className="bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none"/>
                      <input value={newSEO.meta_title} onChange={e => setNewSEO({...newSEO, meta_title: e.target.value})} placeholder="Meta title" className="col-span-2 bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none"/>
                      <input value={newSEO.seo_score} onChange={e => setNewSEO({...newSEO, seo_score: e.target.value})} placeholder="SEO score" className="bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none"/>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={addSEOPage} className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-4 py-1.5 rounded">Add</button>
                      <button onClick={() => setShowNewSEO(false)} className="text-gray-400 text-xs hover:text-white px-3">Cancel</button>
                    </div>
                  </div>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-700 text-gray-400">
                        {['Page', 'Primary Keyword', 'SV', 'KD', 'Position', 'SEO Score', 'Status', 'H1', 'Schema'].map(h => (
                          <th key={h} className="text-left py-2 pr-3 font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {seoPages.map(page => (
                        <tr key={page.id} className="border-b border-gray-700/50 hover:bg-gray-800/30">
                          <td className="py-2 pr-3">
                            <p className="text-white font-medium">{page.page_name}</p>
                            {page.url && <a href={page.url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 truncate block max-w-32">{page.url}</a>}
                          </td>
                          <td className="py-2 pr-3">
                            <input defaultValue={page.primary_keyword || ''} onBlur={e => updateSEOPage(page.id, 'primary_keyword', e.target.value)}
                              className="bg-transparent text-gray-300 w-full focus:outline-none focus:bg-gray-700 rounded px-1" placeholder="—"/>
                          </td>
                          <td className="py-2 pr-3 text-gray-400">{page.primary_kw_volume?.toLocaleString() || '—'}</td>
                          <td className="py-2 pr-3">
                            {page.primary_kw_difficulty != null && (
                              <span className={`text-xs px-1.5 py-0.5 rounded ${page.primary_kw_difficulty < 30 ? 'bg-green-900/50 text-green-300' : page.primary_kw_difficulty < 60 ? 'bg-yellow-900/50 text-yellow-300' : 'bg-red-900/50 text-red-300'}`}>
                                {page.primary_kw_difficulty}
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-3">
                            <input defaultValue={page.primary_kw_position || ''} onBlur={e => updateSEOPage(page.id, 'primary_kw_position', parseInt(e.target.value) || null)}
                              className={`bg-transparent w-12 focus:outline-none focus:bg-gray-700 rounded px-1 ${page.primary_kw_position <= 3 ? 'text-green-400' : page.primary_kw_position <= 10 ? 'text-yellow-400' : 'text-gray-400'}`} placeholder="—"/>
                          </td>
                          <td className="py-2 pr-3">
                            <input defaultValue={page.seo_score || ''} onBlur={e => updateSEOPage(page.id, 'seo_score', parseInt(e.target.value) || null)}
                              className={`bg-transparent w-10 focus:outline-none focus:bg-gray-700 rounded px-1 ${page.seo_score >= 80 ? 'text-green-400' : page.seo_score >= 60 ? 'text-yellow-400' : 'text-gray-400'}`} placeholder="—"/>
                          </td>
                          <td className="py-2 pr-3">
                            <select value={page.content_status || 'not_started'} onChange={e => updateSEOPage(page.id, 'content_status', e.target.value)}
                              className={`text-xs px-2 py-0.5 rounded-full border-0 ${CONTENT_STATUS_COLORS[page.content_status] || 'bg-gray-700 text-gray-300'}`}>
                              {['not_started','drafting','review','approved','published'].map(s => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
                            </select>
                          </td>
                          <td className="py-2 pr-3">
                            <button onClick={() => updateSEOPage(page.id, 'h1_optimized', !page.h1_optimized)}
                              className={`text-xs ${page.h1_optimized ? 'text-green-400' : 'text-gray-600'}`}>
                              {page.h1_optimized ? '✓' : '○'}
                            </button>
                          </td>
                          <td className="py-2 pr-3">
                            <button onClick={() => updateSEOPage(page.id, 'schema_added', !page.schema_added)}
                              className={`text-xs ${page.schema_added ? 'text-green-400' : 'text-gray-600'}`}>
                              {page.schema_added ? '✓' : '○'}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {seoPages.length === 0 && <div className="text-center py-8 text-gray-500"><p className="text-sm">No pages tracked yet</p></div>}
                </div>
              </div>
            )}

            {/* CONTENT */}
            {activeTab === 'content' && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-semibold text-gray-300">Content ({content.length})</h3>
                    <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
                      {['all', 'blog', 'copy', 'email'].map(f => (
                        <button key={f} onClick={() => setContentFilter(f)}
                          className={`px-2 py-1 text-xs rounded-md capitalize ${contentFilter === f ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}>
                          {f}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button onClick={() => setShowNewContent(!showNewContent)} className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-3 py-1.5 rounded-lg">+ Add Content</button>
                </div>

                {showNewContent && (
                  <div className="bg-gray-800 rounded-xl p-4 mb-4 border border-gray-700 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <select value={newContent.content_type} onChange={e => setNewContent({...newContent, content_type: e.target.value})}
                        className="bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none">
                        {['blog','copy','email','social','press_release','case_study'].map(t => <option key={t} value={t}>{t.replace(/_/g,' ')}</option>)}
                      </select>
                      <input value={newContent.title} onChange={e => setNewContent({...newContent, title: e.target.value})} placeholder="Title *"
                        className="bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500"/>
                      <input value={newContent.primary_keyword} onChange={e => setNewContent({...newContent, primary_keyword: e.target.value})} placeholder="Primary keyword"
                        className="bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none"/>
                      <input value={newContent.assigned_writer} onChange={e => setNewContent({...newContent, assigned_writer: e.target.value})} placeholder="Assigned writer"
                        className="bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none"/>
                      <input type="date" value={newContent.publish_date} onChange={e => setNewContent({...newContent, publish_date: e.target.value})}
                        className="bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none"/>
                      <input value={newContent.seo_score} onChange={e => setNewContent({...newContent, seo_score: e.target.value})} placeholder="SEO score"
                        className="bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none"/>
                      <input value={newContent.draft_link} onChange={e => setNewContent({...newContent, draft_link: e.target.value})} placeholder="Draft link"
                        className="bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none"/>
                      <input value={newContent.published_link} onChange={e => setNewContent({...newContent, published_link: e.target.value})} placeholder="Published link"
                        className="bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none"/>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={addContent} className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-4 py-1.5 rounded">Add</button>
                      <button onClick={() => setShowNewContent(false)} className="text-gray-400 text-xs hover:text-white px-3">Cancel</button>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  {content.filter(c => contentFilter === 'all' || c.content_type === contentFilter).map(item => (
                    <div key={item.id} className="bg-gray-800 rounded-xl p-4 border border-gray-700 flex items-center gap-3">
                      <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded capitalize flex-shrink-0">{item.content_type?.replace(/_/g,' ')}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{item.title}</p>
                        {item.primary_keyword && <p className="text-xs text-gray-500 truncate">{item.primary_keyword}</p>}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {item.seo_score && (
                          <span className={`text-xs ${item.seo_score >= 80 ? 'text-green-400' : item.seo_score >= 60 ? 'text-yellow-400' : 'text-gray-400'}`}>
                            SEO {item.seo_score}
                          </span>
                        )}
                        {item.assigned_writer && <span className="text-xs text-gray-500">{item.assigned_writer}</span>}
                        <select value={item.status} onChange={e => updateContent(item.id, 'status', e.target.value)}
                          className={`text-xs px-2 py-0.5 rounded-full border-0 ${CONTENT_STATUS_COLORS[item.status]}`}>
                          {CONTENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                        {item.draft_link && <a href={item.draft_link} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:text-blue-300">Draft</a>}
                        {item.published_link && <a href={item.published_link} target="_blank" rel="noopener noreferrer" className="text-xs text-green-400 hover:text-green-300">↗ Live</a>}
                      </div>
                    </div>
                  ))}
                  {content.length === 0 && <div className="text-center py-8 text-gray-500"><p className="text-sm">No content tracked yet</p></div>}
                </div>
              </div>
            )}

            {/* SOCIAL */}
            {activeTab === 'social' && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-semibold text-gray-300">Social Organic ({socialPosts.length})</h3>
                    <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
                      {['all', ...PLATFORMS].map(p => (
                        <button key={p} onClick={() => setSocialFilter(p)}
                          className={`px-2 py-1 text-xs rounded-md ${socialFilter === p ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}>
                          {p}
                        </button>
                      ))}
                    </div>
                  </div>
                  <button onClick={() => setShowNewPost(!showNewPost)} className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-3 py-1.5 rounded-lg">+ Add Post</button>
                </div>

                {showNewPost && (
                  <div className="bg-gray-800 rounded-xl p-4 mb-4 border border-gray-700 space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                      <select value={newPost.platform} onChange={e => setNewPost({...newPost, platform: e.target.value})}
                        className="bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none">
                        {PLATFORMS.map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                      <select value={newPost.post_type} onChange={e => setNewPost({...newPost, post_type: e.target.value})}
                        className="bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none">
                        {POST_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <input type="date" value={newPost.scheduled_date} onChange={e => setNewPost({...newPost, scheduled_date: e.target.value})}
                        className="bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none"/>
                      <input value={newPost.title} onChange={e => setNewPost({...newPost, title: e.target.value})} placeholder="Post title *" className="col-span-3 bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500"/>
                      <textarea value={newPost.content_brief} onChange={e => setNewPost({...newPost, content_brief: e.target.value})} placeholder="Content brief..." className="col-span-3 bg-gray-700 text-white rounded px-2 py-2 text-xs focus:outline-none resize-none" rows={2}/>
                      <input value={newPost.hashtags} onChange={e => setNewPost({...newPost, hashtags: e.target.value})} placeholder="#hashtags" className="col-span-2 bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none"/>
                      <input value={newPost.media_link} onChange={e => setNewPost({...newPost, media_link: e.target.value})} placeholder="Media link" className="bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none"/>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={addPost} className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-4 py-1.5 rounded">Add Post</button>
                      <button onClick={() => setShowNewPost(false)} className="text-gray-400 text-xs hover:text-white px-3">Cancel</button>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  {socialPosts.filter(p => socialFilter === 'all' || p.platform === socialFilter).map(post => (
                    <div key={post.id} className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded">{post.platform}</span>
                          <span className="text-xs text-gray-500 capitalize">{post.post_type}</span>
                          {post.scheduled_date && <span className="text-xs text-gray-500">{new Date(post.scheduled_date).toLocaleDateString()}</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          <select value={post.status} onChange={e => updatePost(post.id, 'status', e.target.value)}
                            className={`text-xs px-2 py-0.5 rounded-full border-0 ${CONTENT_STATUS_COLORS[post.status]}`}>
                            {CONTENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                          {post.published_link && <a href={post.published_link} target="_blank" rel="noopener noreferrer" className="text-xs text-green-400 hover:text-green-300">↗ Live</a>}
                        </div>
                      </div>
                      <p className="text-sm font-medium text-white mb-1">{post.title}</p>
                      {post.content_brief && <p className="text-xs text-gray-400 mb-2 line-clamp-2">{post.content_brief}</p>}
                      {post.hashtags && <p className="text-xs text-blue-400">{post.hashtags}</p>}
                      {post.media_link && <a href={post.media_link} target="_blank" rel="noopener noreferrer" className="text-xs text-gray-400 hover:text-white mt-1 block">📎 Media</a>}
                    </div>
                  ))}
                  {socialPosts.length === 0 && <div className="text-center py-8 text-gray-500"><p className="text-sm">No posts scheduled yet</p></div>}
                </div>
              </div>
            )}

            {/* PAID */}
            {activeTab === 'paid' && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-semibold text-gray-300">Paid Campaigns ({campaigns.length})</h3>
                  <button onClick={() => setShowNewCampaign(!showNewCampaign)} className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-3 py-1.5 rounded-lg">+ New Campaign</button>
                </div>

                {showNewCampaign && (
                  <div className="bg-gray-800 rounded-xl p-4 mb-4 border border-gray-700 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <select value={newCampaign.platform} onChange={e => setNewCampaign({...newCampaign, platform: e.target.value})}
                        className="bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none">
                        {['Google Ads', 'Meta Ads', 'LinkedIn Ads', 'TikTok Ads', 'Sponsorship', 'Influencer'].map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                      <input value={newCampaign.campaign_name} onChange={e => setNewCampaign({...newCampaign, campaign_name: e.target.value})} placeholder="Campaign name *"
                        className="bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500"/>
                      <input value={newCampaign.budget_daily} onChange={e => setNewCampaign({...newCampaign, budget_daily: e.target.value})} placeholder="Daily budget ($)"
                        className="bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none"/>
                      <input value={newCampaign.budget_total} onChange={e => setNewCampaign({...newCampaign, budget_total: e.target.value})} placeholder="Total budget ($)"
                        className="bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none"/>
                      <input type="date" value={newCampaign.start_date} onChange={e => setNewCampaign({...newCampaign, start_date: e.target.value})}
                        className="bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none"/>
                      <input type="date" value={newCampaign.end_date} onChange={e => setNewCampaign({...newCampaign, end_date: e.target.value})}
                        className="bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none"/>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={addCampaign} className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-4 py-1.5 rounded">Create</button>
                      <button onClick={() => setShowNewCampaign(false)} className="text-gray-400 text-xs hover:text-white px-3">Cancel</button>
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  {campaigns.map(campaign => {
                    const ctr = campaign.clicks && campaign.impressions ? ((campaign.clicks / campaign.impressions) * 100).toFixed(2) : null
                    const cpc = campaign.clicks && campaign.spend_to_date ? (campaign.spend_to_date / campaign.clicks).toFixed(2) : null
                    return (
                      <div key={campaign.id} className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="text-sm font-semibold text-white">{campaign.campaign_name}</h4>
                              <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded">{campaign.platform}</span>
                            </div>
                            {campaign.start_date && <p className="text-xs text-gray-500 mt-0.5">{new Date(campaign.start_date).toLocaleDateString()} — {campaign.end_date ? new Date(campaign.end_date).toLocaleDateString() : 'ongoing'}</p>}
                          </div>
                          <select value={campaign.status} onChange={e => updateCampaign(campaign.id, { status: e.target.value })}
                            className={`text-xs px-2 py-0.5 rounded-full border-0 ${CAMPAIGN_STATUS_COLORS[campaign.status]}`}>
                            {['draft','scheduled','live','paused','ended'].map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </div>
                        <div className="grid grid-cols-6 gap-3 text-center">
                          {[
                            { label: 'Budget/day', value: campaign.budget_daily ? `$${campaign.budget_daily}` : '—' },
                            { label: 'Spend', value: campaign.spend_to_date ? `$${campaign.spend_to_date}` : '—', editable: true, field: 'spend_to_date' },
                            { label: 'Impressions', value: campaign.impressions?.toLocaleString() || '—', editable: true, field: 'impressions' },
                            { label: 'Clicks', value: campaign.clicks?.toLocaleString() || '—', editable: true, field: 'clicks' },
                            { label: 'CTR', value: ctr ? `${ctr}%` : '—' },
                            { label: 'Conversions', value: campaign.conversions?.toString() || '—', editable: true, field: 'conversions' },
                          ].map(stat => (
                            <div key={stat.label} className="bg-gray-700/50 rounded-lg p-2">
                              <p className="text-xs text-gray-500 mb-0.5">{stat.label}</p>
                              {stat.editable ? (
                                <input defaultValue={campaign[stat.field] || ''} onBlur={e => updateCampaign(campaign.id, { [stat.field]: parseFloat(e.target.value) || 0 })}
                                  className="text-sm font-bold text-white bg-transparent w-full text-center focus:outline-none focus:bg-gray-600 rounded" />
                              ) : (
                                <p className="text-sm font-bold text-white">{stat.value}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                  {campaigns.length === 0 && <div className="text-center py-8 text-gray-500"><p className="text-sm">No campaigns yet</p></div>}
                </div>
              </div>
            )}

            {/* CALENDAR */}
            {activeTab === 'calendar' && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <h3 className="text-sm font-semibold text-gray-300">Content Calendar ({allCalendarItems.length} items)</h3>
                    <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
                      <button onClick={() => setCalendarView('unified')} className={`px-2 py-1 text-xs rounded-md ${calendarView === 'unified' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}>Unified</button>
                      <button onClick={() => setCalendarView('social')} className={`px-2 py-1 text-xs rounded-md ${calendarView === 'social' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}>Social</button>
                      <button onClick={() => setCalendarView('email')} className={`px-2 py-1 text-xs rounded-md ${calendarView === 'email' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}>Email</button>
                    </div>
                  </div>
                  {calendarView === 'email' && (
                    <button onClick={() => setShowNewEmail(!showNewEmail)} className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-3 py-1.5 rounded-lg">+ Email</button>
                  )}
                </div>

                {showNewEmail && (
                  <div className="bg-gray-800 rounded-xl p-4 mb-4 border border-gray-700 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <select value={newEmail.email_type} onChange={e => setNewEmail({...newEmail, email_type: e.target.value})}
                        className="bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none">
                        {['service','event','holiday','newsletter','promotional'].map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <input type="date" value={newEmail.send_date} onChange={e => setNewEmail({...newEmail, send_date: e.target.value})}
                        className="bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none"/>
                      <input value={newEmail.subject_line} onChange={e => setNewEmail({...newEmail, subject_line: e.target.value})} placeholder="Subject line *"
                        className="col-span-2 bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500"/>
                      <input value={newEmail.target_segment} onChange={e => setNewEmail({...newEmail, target_segment: e.target.value})} placeholder="Target segment"
                        className="bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none"/>
                      <input value={newEmail.goal} onChange={e => setNewEmail({...newEmail, goal: e.target.value})} placeholder="Campaign goal"
                        className="bg-gray-700 text-white rounded px-2 py-1.5 text-xs focus:outline-none"/>
                      <textarea value={newEmail.key_hook} onChange={e => setNewEmail({...newEmail, key_hook: e.target.value})} placeholder="Key hook / events covered"
                        className="col-span-2 bg-gray-700 text-white rounded px-2 py-2 text-xs focus:outline-none resize-none" rows={2}/>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={addEmail} className="bg-purple-600 hover:bg-purple-700 text-white text-xs px-4 py-1.5 rounded">Add Email</button>
                      <button onClick={() => setShowNewEmail(false)} className="text-gray-400 text-xs hover:text-white px-3">Cancel</button>
                    </div>
                  </div>
                )}

                {/* Unified calendar */}
                {calendarView === 'unified' && (
                  <div className="space-y-2">
                    {allCalendarItems.map((item, i) => {
                      const typeColor = item.itemType === 'social' ? 'bg-orange-900/50 text-orange-300' : item.itemType === 'email' ? 'bg-blue-900/50 text-blue-300' : 'bg-amber-900/50 text-amber-300'
                      return (
                        <div key={i} className="bg-gray-800 rounded-xl p-3 border border-gray-700 flex items-center gap-3">
                          <div className="w-16 text-center flex-shrink-0">
                            <p className="text-xs text-gray-400">{new Date(item.date).toLocaleDateString('en', { month: 'short', day: 'numeric' })}</p>
                          </div>
                          <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 capitalize ${typeColor}`}>{item.itemType}</span>
                          {item.platform && <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded flex-shrink-0">{item.platform}</span>}
                          <p className="text-sm text-white flex-1 truncate">{item.title || item.subject_line}</p>
                          <span className={`text-xs flex-shrink-0 ${CONTENT_STATUS_COLORS[item.status]?.split(' ')[1] || 'text-gray-400'}`}>{item.status}</span>
                        </div>
                      )
                    })}
                    {allCalendarItems.length === 0 && <div className="text-center py-8 text-gray-500"><p className="text-sm">No scheduled content yet</p></div>}
                  </div>
                )}

                {/* Social calendar drill-down */}
                {calendarView === 'social' && (
                  <div className="space-y-4">
                    {PLATFORMS.filter(p => scope[`social_${p.toLowerCase()}`]).map(platform => {
                      const platformPosts = socialPosts.filter(p => p.platform === platform)
                      return (
                        <div key={platform} className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                          <div className="flex items-center justify-between mb-3">
                            <h4 className="text-sm font-semibold text-white">{platform}</h4>
                            <span className="text-xs text-gray-500">{platformPosts.length} posts</span>
                          </div>
                          {platformPosts.length > 0 ? (
                            <div className="space-y-2">
                              {platformPosts.map(post => (
                                <div key={post.id} className="flex items-center gap-3 bg-gray-700/50 rounded-lg px-3 py-2">
                                  {post.scheduled_date && <span className="text-xs text-gray-400 w-16 flex-shrink-0">{new Date(post.scheduled_date).toLocaleDateString('en', { month: 'short', day: 'numeric' })}</span>}
                                  <span className="text-xs text-gray-500 capitalize flex-shrink-0">{post.post_type}</span>
                                  <p className="text-xs text-white flex-1 truncate">{post.title}</p>
                                  <span className={`text-xs px-2 py-0.5 rounded-full ${CONTENT_STATUS_COLORS[post.status]}`}>{post.status}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-gray-600">No posts scheduled</p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Email calendar */}
                {calendarView === 'email' && (
                  <div className="space-y-3">
                    {emails.map(email => (
                      <div key={email.id} className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs bg-blue-900/50 text-blue-300 px-2 py-0.5 rounded-full capitalize">{email.email_type}</span>
                              {email.send_date && <span className="text-xs text-gray-400">{new Date(email.send_date).toLocaleDateString()}</span>}
                            </div>
                            <p className="text-sm font-medium text-white">{email.subject_line}</p>
                          </div>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${email.status === 'sent' ? 'bg-green-900/50 text-green-300' : email.status === 'scheduled' ? 'bg-blue-900/50 text-blue-300' : 'bg-gray-700 text-gray-300'}`}>{email.status}</span>
                        </div>
                        {email.target_segment && <p className="text-xs text-gray-400 mb-1">Target: {email.target_segment}</p>}
                        {email.key_hook && <p className="text-xs text-gray-500 line-clamp-2">{email.key_hook}</p>}
                        {email.goal && <p className="text-xs text-purple-400 mt-1">Goal: {email.goal}</p>}
                      </div>
                    ))}
                    {emails.length === 0 && <div className="text-center py-8 text-gray-500"><p className="text-sm">No emails scheduled yet</p></div>}
                  </div>
                )}
              </div>
            )}

            {/* SCOPE */}
            {activeTab === 'scope' && (
              <div className="space-y-5">
                <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                  <p className="text-xs text-gray-400 mb-1">
                    {profile?.role === 'admin' ? 'Admin · full control' : 'Marketing team · can adjust channels'}
                  </p>
                  <p className="text-sm text-gray-300">Toggle which marketing channels are active for this project. The scope diagram updates live.</p>
                </div>

                {/* Scope diagram — live SVG based on scope state */}
                <div className="bg-gray-900 rounded-xl p-4 border border-gray-700">
                  <svg width="100%" viewBox="0 0 640 320" className="overflow-visible">
                    <defs>
                      <marker id="sarrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                        <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" strokeWidth="1.5" strokeLinecap="round"/>
                      </marker>
                    </defs>
                    {/* Root */}
                    <rect x="240" y="10" width="160" height="38" rx="8" fill="#4C1D95" stroke="#7C3AED" strokeWidth="0.5"/>
                    <text x="320" y="29" textAnchor="middle" dominantBaseline="central" fontSize="12" fontWeight="500" fill="#DDD6FE">{selectedProject?.name || 'Project'}</text>
                    <text x="320" y="42" textAnchor="middle" dominantBaseline="central" fontSize="10" fill="#A78BFA">Marketing</text>

                    {/* Branches */}
                    {[
                      { x: 20, label: 'SEO', color: '#0F6E56', stroke: '#1D9E75', textColor: '#5DCAA5', children: [{ key: 'seo_onpage', label: 'On-page' }, { key: 'seo_technical', label: 'Technical' }, { key: 'seo_offpage', label: 'Off-page' }] },
                      { x: 150, label: 'Content', color: '#854F0B', stroke: '#EF9F27', textColor: '#FAC775', children: [{ key: 'content_blogs', label: 'Blogs' }, { key: 'content_copy', label: 'Copy' }, { key: 'content_email', label: 'Email' }] },
                      { x: 290, label: 'Social', color: '#993C1D', stroke: '#D85A30', textColor: '#F09977', children: [{ key: 'social_instagram', label: 'IG' }, { key: 'social_tiktok', label: 'TikTok' }, { key: 'social_linkedin', label: 'LinkedIn' }] },
                      { x: 420, label: 'Paid', color: '#185FA5', stroke: '#378ADD', textColor: '#85B7EB', children: [{ key: 'paid_google', label: 'Google' }, { key: 'paid_meta', label: 'Meta' }] },
                      { x: 530, label: 'Analytics', color: '#27500A', stroke: '#639922', textColor: '#97C459', children: [{ key: 'analytics_gsc', label: 'GSC' }, { key: 'analytics_ga4', label: 'GA4' }] },
                    ].map((branch, bi) => {
                      const cx = branch.x + 70
                      const activeChildren = branch.children.filter(c => scope[c.key])
                      const isActive = activeChildren.length > 0
                      return (
                        <g key={bi} opacity={isActive ? 1 : 0.35}>
                          <line x1="320" y1="48" x2={cx} y2="100" stroke={isActive ? branch.stroke : '#555'} strokeWidth="0.8" markerEnd="url(#sarrow)" opacity="0.6"/>
                          <rect x={branch.x} y="100" width="140" height="32" rx="6" fill={isActive ? branch.color : '#2a2a2a'} stroke={isActive ? branch.stroke : '#444'} strokeWidth="0.5"/>
                          <text x={cx} y="116" textAnchor="middle" dominantBaseline="central" fontSize="11" fontWeight="500" fill={isActive ? branch.textColor : '#666'}>{branch.label}</text>
                          {branch.children.map((child, ci) => {
                            const childX = branch.x + (ci * (140 / branch.children.length))
                            const childW = 140 / branch.children.length - 4
                            const active = scope[child.key]
                            return (
                              <g key={ci}>
                                <line x1={childX + childW/2} y1="132" x2={childX + childW/2} y2="188" stroke={active ? branch.stroke : '#444'} strokeWidth="0.6" opacity="0.5"/>
                                <rect x={childX + 2} y="190" width={childW} height="28" rx="4" fill={active ? branch.color + '80' : '#1f1f1f'} stroke={active ? branch.stroke : '#333'} strokeWidth="0.5"/>
                                <text x={childX + childW/2 + 2} y="204" textAnchor="middle" dominantBaseline="central" fontSize="9" fill={active ? branch.textColor : '#555'}>{child.label}</text>
                              </g>
                            )
                          })}
                        </g>
                      )
                    })}
                  </svg>
                </div>

                {/* Scope toggles */}
                {Object.entries(SCOPE_CHANNELS).map(([key, channel]) => {
                  const c = COLOR_MAP[channel.color]
                  return (
                    <div key={key} className={`rounded-xl p-4 border ${c.bg} ${c.border}`}>
                      <h4 className={`text-sm font-semibold ${c.text} mb-3`}>{channel.label}</h4>
                      <div className="flex gap-2 flex-wrap">
                        {channel.children.map(child => (
                          <button key={child.key} onClick={() => saveScope({ [child.key]: !scope[child.key] })}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-all ${scope[child.key] ? `${c.bg} ${c.border} ${c.text}` : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300'}`}>
                            <div className={`w-2 h-2 rounded-full ${scope[child.key] ? c.dot : 'bg-gray-600'}`} />
                            {child.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* FILES TAB */}
            {activeTab === 'files' && selectedProjectId && (
              <MarketingFiles
                projectId={selectedProjectId}
                userId={user?.id}
              />
            )}
            {activeTab === 'files' && !selectedProjectId && (
              <div className="text-center py-16 text-gray-500">
                <p className="text-4xl mb-3">📎</p>
                <p className="text-sm">Select a project to manage files</p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
