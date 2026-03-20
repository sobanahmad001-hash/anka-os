import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'

const OPENAI_KEY = import.meta.env.VITE_OPENAI_KEY
const SILICONFLOW_KEY = import.meta.env.VITE_SILICONFLOW_KEY
const FAL_KEY = import.meta.env.VITE_FAL_KEY

const IMAGE_SIZES = ['1024x1024', '1792x1024', '1024x1792']
const IMAGE_SIZE_LABELS = { '1024x1024': '1:1 Square', '1792x1024': '16:9 Landscape', '1024x1792': '9:16 Portrait' }
const IMAGE_STYLES = ['vivid', 'natural']
const IMAGE_QUALITIES = ['standard', 'hd']

const VIDEO_DURATIONS = [5, 8, 10]

const IMAGE_PROVIDERS = [
  { id: 'fal', label: 'FAL · Flux Pro', badge: '$0.03/img · Best quality', color: 'bg-purple-900/50 text-purple-300' },
  { id: 'siliconflow', label: 'Siliconflow', badge: 'Free credits · Kolors', color: 'bg-green-900/50 text-green-300' },
  { id: 'dalle', label: 'DALL-E 3', badge: '$0.04/img · Best for text', color: 'bg-blue-900/50 text-blue-300' },
]

const VIDEO_PROVIDERS = [
  { id: 'fal_video', label: 'Kling 2.1', badge: '~$0.35/5s · FAL.AI', color: 'bg-purple-900/50 text-purple-300' },
  { id: 'sora', label: 'Sora 2', badge: '$0.50/5s · OpenAI', color: 'bg-blue-900/50 text-blue-300' },
]

async function generateDALLE(prompt, size, quality, style) {
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'dall-e-3',
      prompt,
      n: 1,
      size: size || '1024x1024',
      quality: quality || 'standard',
      style: style || 'vivid',
    }),
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error?.message || `DALL-E error: ${response.status}`)
  }
  const data = await response.json()
  const url = data.data?.[0]?.url
  if (!url) throw new Error('No image URL returned')
  return { url, provider: 'dall-e-3', revised_prompt: data.data?.[0]?.revised_prompt }
}

async function generateSiliconflow(prompt, size) {
  const sizeMap = {
    '1024x1024': '1024x1024',
    '1792x1024': '1280x720',
    '1024x1792': '720x1280',
  }
  const response = await fetch('https://api.siliconflow.cn/v1/images/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SILICONFLOW_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'Kwai-Kolors/Kolors',
      prompt,
      image_size: sizeMap[size] || '1024x1024',
      num_inference_steps: 20,
    }),
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.message || `Siliconflow error: ${response.status}`)
  }
  const data = await response.json()
  const url = data.images?.[0]?.url
  if (!url) throw new Error('No image returned')
  return { url, provider: 'siliconflow' }
}

async function generateFAL(prompt, size) {
  const sizeMap = {
    '1024x1024': { width: 1024, height: 1024 },
    '1792x1024': { width: 1792, height: 1024 },
    '1024x1792': { width: 1024, height: 1792 },
  }
  const dims = sizeMap[size] || { width: 1024, height: 1024 }

  // Submit request
  const submitRes = await fetch('https://queue.fal.run/fal-ai/flux-pro/v1.1', {
    method: 'POST',
    headers: {
      Authorization: `Key ${FAL_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      image_size: dims,
      num_inference_steps: 28,
      guidance_scale: 3.5,
      num_images: 1,
      safety_tolerance: '2',
    }),
  })
  if (!submitRes.ok) {
    const err = await submitRes.json().catch(() => ({}))
    throw new Error(err.detail || err.message || `FAL submit error: ${submitRes.status}`)
  }
  const { request_id } = await submitRes.json()
  if (!request_id) throw new Error('No request ID from FAL')

  // Poll for result
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 3000))
    const statusRes = await fetch(
      `https://queue.fal.run/fal-ai/flux-pro/v1.1/requests/${request_id}`,
      { headers: { Authorization: `Key ${FAL_KEY}` } }
    )
    const statusData = await statusRes.json()
    if (statusData.status === 'COMPLETED') {
      const url = statusData.output?.images?.[0]?.url
      if (!url) throw new Error('No image URL in FAL response')
      return { url, provider: 'fal-flux-pro' }
    }
    if (statusData.status === 'FAILED') throw new Error(statusData.error || 'FAL generation failed')
  }
  throw new Error('FAL timed out')
}

async function generateFALVideo(prompt, duration) {
  // Submit Kling request
  const submitRes = await fetch('https://queue.fal.run/fal-ai/kling-video/v2.1/standard/text-to-video', {
    method: 'POST',
    headers: {
      Authorization: `Key ${FAL_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      duration: duration <= 5 ? '5' : '10',
      aspect_ratio: '16:9',
    }),
  })
  if (!submitRes.ok) {
    const err = await submitRes.json().catch(() => ({}))
    throw new Error(err.detail || err.message || `FAL video submit error: ${submitRes.status}`)
  }
  const { request_id } = await submitRes.json()
  if (!request_id) throw new Error('No request ID from FAL')

  // Poll for result
  for (let i = 0; i < 36; i++) {
    await new Promise(r => setTimeout(r, 5000))
    const statusRes = await fetch(
      `https://queue.fal.run/fal-ai/kling-video/v2.1/standard/text-to-video/requests/${request_id}`,
      { headers: { Authorization: `Key ${FAL_KEY}` } }
    )
    const statusData = await statusRes.json()
    if (statusData.status === 'COMPLETED') {
      const url = statusData.output?.video?.url
      if (!url) throw new Error('No video URL in FAL response')
      return { url, provider: 'kling-2.1' }
    }
    if (statusData.status === 'FAILED') throw new Error(statusData.error || 'FAL video failed')
  }
  throw new Error('FAL video timed out after 3 minutes')
}

async function createSoraVideo(prompt, duration) {
  const response = await fetch('https://api.openai.com/v1/videos/generations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'sora-2',
      prompt,
      duration,
      resolution: '720p',
      n: 1,
    }),
  })
  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error?.message || `Sora error: ${response.status}`)
  }
  const data = await response.json()
  return data.id || data.data?.[0]?.id
}

async function getSoraStatus(videoId) {
  const response = await fetch(`https://api.openai.com/v1/videos/generations/${videoId}`, {
    headers: { Authorization: `Bearer ${OPENAI_KEY}` }
  })
  if (!response.ok) throw new Error(`Status check failed: ${response.status}`)
  return await response.json()
}

export default function SphereCreativeStudio() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState('image')
  const [projects, setProjects] = useState([])
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [assets, setAssets] = useState([])
  const [brandGuide, setBrandGuide] = useState(null)
  const [assetsLoading, setAssetsLoading] = useState(false)

  const [imagePrompt, setImagePrompt] = useState('')
  const [imageSize, setImageSize] = useState('1024x1024')
  const [imageQuality, setImageQuality] = useState('standard')
  const [imageStyle, setImageStyle] = useState('vivid')
  const [imageProvider, setImageProvider] = useState('fal')
  const [generatedImages, setGeneratedImages] = useState([])
  const [imageLoading, setImageLoading] = useState(false)
  const [imageError, setImageError] = useState('')

  const [videoPrompt, setVideoPrompt] = useState('')
  const [videoDuration, setVideoDuration] = useState(5)
  const [videoProvider, setVideoProvider] = useState('fal_video')
  const [generatedVideos, setGeneratedVideos] = useState([])
  const [videoLoading, setVideoLoading] = useState(false)
  const [videoError, setVideoError] = useState('')
  const [videoStatus, setVideoStatus] = useState('')

  const [editingBrand, setEditingBrand] = useState(false)
  const [brandForm, setBrandForm] = useState({
    brand_name: '', primary_colors: '', secondary_colors: '',
    fonts: '', brand_tone: '', target_audience: '',
    brand_positioning: '', logo_url: '', guidelines_url: ''
  })
  const [savingBrand, setSavingBrand] = useState(false)

  const [uploadingAsset, setUploadingAsset] = useState(false)
  const fileRef = useRef(null)
  const logoRef = useRef(null)

  useEffect(() => { fetchProjects() }, [])
  useEffect(() => { if (selectedProjectId) { fetchAssets(); fetchBrandGuide() } }, [selectedProjectId])

  async function fetchProjects() {
    const { data } = await supabase.from('as_projects')
      .select('id, name, as_clients(name)').order('name')
    setProjects(data || [])
  }

  async function fetchAssets() {
    setAssetsLoading(true)
    const { data } = await supabase.from('as_deliverables')
      .select('*').eq('project_id', selectedProjectId)
      .in('deliverable_type', ['generated_image', 'generated_video', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4', 'mov'])
      .order('created_at', { ascending: false })
    setAssets(data || [])
    setAssetsLoading(false)
  }

  async function fetchBrandGuide() {
    const { data } = await supabase.from('as_project_documents')
      .select('*').eq('project_id', selectedProjectId).eq('doc_type', 'brand_identity').single()
    if (data) {
      setBrandGuide(data)
      try { setBrandForm(JSON.parse(data.content)) } catch { }
    }
  }

  async function saveToLibrary(url, type, title, blob) {
    if (!selectedProjectId) return
    try {
      let finalUrl = url
      if (blob) {
        const ext = type === 'video' ? 'mp4' : 'png'
        const fileName = `${selectedProjectId}/${Date.now()}.${ext}`
        const { error } = await supabase.storage.from('sphere-deliverables').upload(fileName, blob)
        if (!error) {
          const { data } = supabase.storage.from('sphere-deliverables').getPublicUrl(fileName)
          finalUrl = data.publicUrl
        }
      }
      await supabase.from('as_deliverables').insert({
        project_id: selectedProjectId,
        phase: 'product_modeling',
        title: title || `Generated ${type}`,
        file_url: finalUrl,
        deliverable_type: type === 'video' ? 'generated_video' : 'generated_image',
        file_type: type === 'video' ? 'video/mp4' : 'image/png',
        created_by: user?.id, uploaded_by: user?.id
      })
      fetchAssets()
    } catch (err) { console.error('Save error:', err) }
  }

  async function generateImage() {
    if (!imagePrompt.trim()) return
    setImageLoading(true)
    setImageError('')
    try {
      let result
      if (imageProvider === 'fal') result = await generateFAL(imagePrompt, imageSize)
      else if (imageProvider === 'siliconflow') result = await generateSiliconflow(imagePrompt, imageSize)
      else if (imageProvider === 'dalle') result = await generateDALLE(imagePrompt, imageSize, imageQuality, imageStyle)
      else { setImageError('Provider not configured'); setImageLoading(false); return }
      setGeneratedImages(prev => [{ ...result, prompt: imagePrompt, size: imageSize, ts: Date.now() }, ...prev.slice(0, 7)])
    } catch (err) { setImageError(err.message) }
    setImageLoading(false)
  }

  async function generateVideo() {
    if (!videoPrompt.trim()) return
    setVideoLoading(true)
    setVideoError('')
    setVideoStatus('Submitting to ' + (videoProvider === 'fal_video' ? 'Kling 2.1 via FAL' : 'Sora 2 via OpenAI') + '...')
    try {
      let result
      if (videoProvider === 'fal_video') result = await generateFALVideo(videoPrompt, videoDuration)
      else result = await generateSoraVideo(videoPrompt, videoDuration)
      setGeneratedVideos(prev => [{ ...result, prompt: videoPrompt, duration: videoDuration, ts: Date.now() }, ...prev.slice(0, 5)])
      setVideoStatus('')
    } catch (err) {
      setVideoError(err.message)
      setVideoStatus('')
    }
    setVideoLoading(false)
  }

  async function generateSoraVideo(prompt, duration) {
    setVideoStatus('Creating Sora 2 video job...')
    const response = await fetch('https://api.openai.com/v1/videos/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'sora-2',
        prompt,
        duration,
        resolution: '720p',
        n: 1,
      }),
    })
    if (!response.ok) {
      const err = await response.json().catch(() => ({}))
      throw new Error(err.error?.message || `Sora error: ${response.status}`)
    }
    const data = await response.json()
    const videoId = data.id || data.data?.[0]?.id
    if (!videoId) throw new Error('No video ID from Sora')

    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 10000))
      const statusRes = await fetch(`https://api.openai.com/v1/videos/generations/${videoId}`, {
        headers: { Authorization: `Bearer ${OPENAI_KEY}` }
      })
      const status = await statusRes.json()
      setVideoStatus(`Sora status: ${status.status} — attempt ${i + 1}/30`)
      if (status.status === 'completed') {
        const url = status.data?.[0]?.url || status.url
        if (!url) throw new Error('No video URL')
        return { url, provider: 'sora-2' }
      }
      if (status.status === 'failed') throw new Error('Sora generation failed')
    }
    throw new Error('Sora timed out')
  }

  async function handleAssetUpload(e) {
    const file = e.target.files?.[0]
    if (!file || !selectedProjectId) return
    setUploadingAsset(true)
    const ext = file.name.split('.').pop()
    const fileName = `${selectedProjectId}/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('sphere-deliverables').upload(fileName, file)
    if (!error) {
      const { data } = supabase.storage.from('sphere-deliverables').getPublicUrl(fileName)
      await supabase.from('as_deliverables').insert({
        project_id: selectedProjectId, phase: 'product_modeling',
        title: file.name, file_url: data.publicUrl,
        deliverable_type: ext, file_type: file.type,
        file_size: file.size, created_by: user?.id, uploaded_by: user?.id
      })
      fetchAssets()
    }
    setUploadingAsset(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function saveBrandGuide() {
    if (!selectedProjectId) return
    setSavingBrand(true)
    const content = JSON.stringify(brandForm)
    if (brandGuide) {
      await supabase.from('as_project_documents').update({
        content, version: (brandGuide.version || 1) + 1,
        updated_by: user?.id, updated_at: new Date().toISOString()
      }).eq('id', brandGuide.id)
    } else {
      await supabase.from('as_project_documents').insert({
        project_id: selectedProjectId, doc_type: 'brand_identity',
        title: `${brandForm.brand_name || 'Brand'} Guidelines`,
        content, updated_by: user?.id
      })
    }
    await fetchBrandGuide()
    setEditingBrand(false)
    setSavingBrand(false)
  }

  async function deleteAsset(asset) {
    if (asset.file_url?.includes('sphere-deliverables')) {
      const path = asset.file_url.split('sphere-deliverables/')[1]
      if (path) await supabase.storage.from('sphere-deliverables').remove([path])
    }
    await supabase.from('as_deliverables').delete().eq('id', asset.id)
    fetchAssets()
  }

  const videoCost = videoProvider === 'fal_video'
    ? `~$${(videoDuration * 0.07).toFixed(2)}`
    : `~$${(videoDuration * 0.10).toFixed(2)}`

  return (
    <div className="flex flex-col h-full bg-gray-950 text-white">
      <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">Creative Studio</h2>
          <p className="text-xs text-gray-400 mt-0.5">DALL-E 3 · Sora 2 · Asset library · Brand guidelines</p>
        </div>
        <select value={selectedProjectId} onChange={e => setSelectedProjectId(e.target.value)}
          className="bg-gray-800 text-gray-300 text-xs rounded-lg px-3 py-2 border border-gray-700 focus:outline-none focus:ring-1 focus:ring-purple-500">
          <option value="">Select project</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}{p.as_clients?.name ? ` · ${p.as_clients.name}` : ''}</option>)}
        </select>
      </div>

      <div className="flex gap-1 px-6 py-3 border-b border-gray-800">
        {[
          { id: 'image', label: '🖼️ Images' },
          { id: 'video', label: '🎥 Video' },
          { id: 'assets', label: '📁 Asset Library' },
          { id: 'brand', label: '🎨 Brand Guidelines' },
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${activeTab === tab.id ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-6">

        {activeTab === 'image' && (
          <div className="space-y-5">
            {/* Provider selector - Images */}
            <div>
              <label className="block text-xs text-gray-400 uppercase tracking-wide mb-2">Provider</label>
              <div className="flex gap-2 flex-wrap">
                {IMAGE_PROVIDERS.map(p => (
                  <button key={p.id} onClick={() => setImageProvider(p.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all ${imageProvider === p.id ? 'border-purple-500 bg-purple-900/20' : 'border-gray-700 bg-gray-800 hover:border-gray-600'}`}>
                    <span className="text-sm font-medium text-white">{p.label}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${p.color}`}>{p.badge}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Size</label>
                <div className="flex flex-col gap-1">
                  {IMAGE_SIZES.map(s => (
                    <button key={s} onClick={() => setImageSize(s)}
                      className={`px-3 py-1.5 text-xs rounded-lg text-left transition-colors ${imageSize === s ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'}`}>
                      {IMAGE_SIZE_LABELS[s]}
                    </button>
                  ))}
                </div>
              </div>
              {imageProvider === 'dalle' && (
                <>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Quality</label>
                    <div className="flex flex-col gap-1">
                      {IMAGE_QUALITIES.map(q => (
                        <button key={q} onClick={() => setImageQuality(q)}
                          className={`px-3 py-1.5 text-xs rounded-lg capitalize transition-colors ${imageQuality === q ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'}`}>
                          {q} {q === 'hd' ? '($0.08)' : '($0.04)'}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Style</label>
                    <div className="flex flex-col gap-1">
                      {IMAGE_STYLES.map(s => (
                        <button key={s} onClick={() => setImageStyle(s)}
                          className={`px-3 py-1.5 text-xs rounded-lg capitalize transition-colors ${imageStyle === s ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'}`}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Prompt</label>
              <div className="flex gap-2">
                <textarea value={imagePrompt} onChange={e => setImagePrompt(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && e.ctrlKey && generateImage()}
                  className="flex-1 bg-gray-800 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 border border-gray-700 resize-none"
                  rows={3} placeholder="Describe the image... (Ctrl+Enter to generate)" />
                <button onClick={generateImage} disabled={imageLoading || !imagePrompt.trim()}
                  className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-5 rounded-xl text-sm font-medium transition-colors flex-shrink-0 flex flex-col items-center justify-center gap-1">
                  {imageLoading ? <><span className="animate-spin text-lg">⏳</span><span className="text-xs">Gen...</span></> : <><span>✨</span><span>Generate</span></>}
                </button>
              </div>
            </div>

            <div>
              <p className="text-xs text-gray-500 mb-2">Quick prompts</p>
              <div className="flex gap-2 flex-wrap">
                {[
                  'Professional brand logo on white background',
                  'Modern website hero section, abstract geometric',
                  'Social media post template, clean minimal design',
                  'Product lifestyle photography, luxury feel',
                  'Corporate team background, professional',
                  'Instagram story template, bold typography',
                ].map(s => (
                  <button key={s} onClick={() => setImagePrompt(s)}
                    className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg border border-gray-700">
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {imageError && (
              <div className="bg-red-900/30 border border-red-700/50 rounded-xl p-3">
                <p className="text-xs text-red-300">❌ {imageError}</p>
              </div>
            )}

            {imageLoading && (
              <div className="bg-gray-800 rounded-xl border border-gray-700 p-12 flex flex-col items-center text-gray-500">
                <div className="text-4xl mb-3 animate-pulse">🎨</div>
                <p className="text-sm font-medium text-white">Generating image...</p>
                <p className="text-xs mt-1 text-gray-500">
                  {imageProvider === 'fal' ? 'FAL Flux Pro usually takes 10-20 seconds' : imageProvider === 'dalle' ? 'DALL-E 3 usually takes 5-15 seconds' : 'Siliconflow usually takes 10-20 seconds'}
                </p>
              </div>
            )}

            {generatedImages.length > 0 && (
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-3">Generated ({generatedImages.length})</p>
                <div className="grid grid-cols-2 gap-4">
                  {generatedImages.map(img => (
                    <div key={img.ts} className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
                      <div className="px-3 py-2 bg-gray-900 border-b border-gray-700 flex items-center gap-2">
                        <p className="text-xs text-gray-400 truncate flex-1">{img.prompt}</p>
                        <a href={img.url} target="_blank" rel="noopener noreferrer"
                          className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded flex-shrink-0">↗ Open</a>
                        {selectedProjectId && (
                          <button onClick={() => saveToLibrary(img.url, 'image', img.prompt.slice(0, 50))}
                            className="text-xs bg-purple-600 hover:bg-purple-700 text-white px-2 py-1 rounded flex-shrink-0">+ Save</button>
                        )}
                      </div>
                      <div style={{
                        backgroundImage: `url("${img.url}")`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        aspectRatio: img.size === '1792x1024' ? '16/9' : img.size === '1024x1792' ? '9/16' : '1/1',
                        minHeight: '200px',
                        backgroundColor: '#111827',
                      }} />
                      {img.revised_prompt && (
                        <div className="px-3 py-2 border-t border-gray-700">
                          <p className="text-xs text-gray-500 line-clamp-2">Revised: {img.revised_prompt}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'video' && (
          <div className="space-y-5">
            <div className="bg-gray-800 rounded-xl p-4 border border-purple-500/30">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-purple-600 rounded-lg flex items-center justify-center text-sm">S2</div>
                <div>
                  <p className="text-sm font-semibold text-white">Sora 2 by OpenAI</p>
                  <p className="text-xs text-gray-400">$0.10/second · 720p · Best quality video generation available</p>
                </div>
              </div>
            </div>

            {/* Provider selector - Video */}
            <div>
              <label className="block text-xs text-gray-400 uppercase tracking-wide mb-2">Provider</label>
              <div className="flex gap-2">
                {VIDEO_PROVIDERS.map(p => (
                  <button key={p.id} onClick={() => setVideoProvider(p.id)}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border transition-all ${videoProvider === p.id ? 'border-purple-500 bg-purple-900/20' : 'border-gray-700 bg-gray-800 hover:border-gray-600'}`}>
                    <span className="text-sm font-medium text-white">{p.label}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${p.color}`}>{p.badge}</span>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-400 uppercase tracking-wide mb-2">Duration</label>
              <div className="flex gap-2">
                {VIDEO_DURATIONS.map(d => (
                  <button key={d} onClick={() => setVideoDuration(d)}
                    className={`flex-1 py-3 rounded-xl text-sm font-medium transition-all ${videoDuration === d ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'}`}>
                    <div>{d}s</div>
                    <div className="text-xs mt-0.5 opacity-70">${(d * 0.10).toFixed(2)}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">Video Prompt</label>
              <div className="flex gap-2">
                <textarea value={videoPrompt} onChange={e => setVideoPrompt(e.target.value)}
                  className="flex-1 bg-gray-800 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 border border-gray-700 resize-none"
                  rows={4} placeholder="Describe your video in detail. Include: shot type, subject, action, setting, lighting, camera movement..." />
                <button onClick={generateVideo} disabled={videoLoading || !videoPrompt.trim()}
                  className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-5 rounded-xl text-sm font-medium transition-colors flex-shrink-0 flex flex-col items-center justify-center gap-1">
                  {videoLoading ? <><span className="animate-spin">⏳</span><span className="text-xs">Gen...</span></> : <><span>🎥</span><span>Generate</span><span className="text-xs opacity-70">{videoCost}</span></>}
                </button>
              </div>
            </div>

            <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
              <p className="text-xs font-medium text-gray-300 mb-2">💡 For best results include:</p>
              <div className="grid grid-cols-2 gap-1 text-xs text-gray-500">
                <span>• Shot type (wide, close-up, aerial)</span>
                <span>• Subject and action</span>
                <span>• Setting and environment</span>
                <span>• Lighting (golden hour, studio)</span>
                <span>• Camera movement (pan, zoom)</span>
                <span>• Mood/style (cinematic, documentary)</span>
              </div>
            </div>

            <div>
              <p className="text-xs text-gray-500 mb-2">Quick prompts</p>
              <div className="flex gap-2 flex-wrap">
                {[
                  'Wide shot of a luxury car driving through city streets at night, cinematic lighting, slow pan',
                  'Close-up product shot of a smartphone rotating on clean white background, studio lighting',
                  'Aerial view of a modern office building, golden hour sunlight, slowly zooming out',
                  'Professional business meeting in glass conference room, natural lighting, camera slowly pans',
                ].map(s => (
                  <button key={s} onClick={() => setVideoPrompt(s)}
                    className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg border border-gray-700 text-left">
                    {s.slice(0, 60)}...
                  </button>
                ))}
              </div>
            </div>

            {videoStatus && (
              <div className="bg-blue-900/20 border border-blue-700/50 rounded-xl p-3">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    {[0,1,2].map(i => (
                      <div key={i} className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                    ))}
                  </div>
                  <p className="text-xs text-blue-300">{videoStatus}</p>
                </div>
              </div>
            )}

            {videoError && (
              <div className="bg-red-900/30 border border-red-700/50 rounded-xl p-3">
                <p className="text-xs text-red-300">❌ {videoError}</p>
              </div>
            )}

            {generatedVideos.length > 0 && (
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-3">Generated Videos</p>
                <div className="space-y-4">
                  {generatedVideos.map(vid => (
                    <div key={vid.ts} className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
                      <video src={vid.url} controls className="w-full" style={{ maxHeight: '360px' }} />
                      <div className="p-3 flex items-center gap-2">
                        <p className="text-xs text-gray-400 flex-1 truncate">{vid.prompt}</p>
                        <span className="text-xs text-gray-500">{vid.duration}s</span>
                        <a href={vid.url} download={`sora_${vid.ts}.mp4`}
                          className="text-xs text-blue-400 hover:text-blue-300">↓ Download</a>
                        {selectedProjectId && (
                          <button onClick={() => saveToLibrary(vid.url, 'video', vid.prompt.slice(0, 50))}
                            className="text-xs text-purple-400 hover:text-purple-300">+ Library</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'assets' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-300">
                Asset Library {selectedProjectId ? `(${assets.length})` : '— select a project'}
              </h3>
              {selectedProjectId && (
                <div>
                  <input ref={fileRef} type="file" onChange={handleAssetUpload} className="hidden" accept="image/*,video/*" />
                  <button onClick={() => fileRef.current?.click()} disabled={uploadingAsset}
                    className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded-lg">
                    {uploadingAsset ? '⏳ Uploading...' : '↑ Upload'}
                  </button>
                </div>
              )}
            </div>

            {!selectedProjectId ? (
              <div className="text-center py-16 text-gray-500">
                <p className="text-4xl mb-3">📁</p>
                <p className="text-sm">Select a project to view assets</p>
              </div>
            ) : assetsLoading ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-500" />
              </div>
            ) : assets.length === 0 ? (
              <div className="text-center py-16 text-gray-500">
                <p className="text-4xl mb-3">🖼️</p>
                <p className="text-sm">No assets yet</p>
                <p className="text-xs mt-1">Generate images/videos or upload files</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-4">
                {assets.map(asset => (
                  <div key={asset.id} className="bg-gray-800 rounded-xl overflow-hidden border border-gray-700 group">
                    {asset.file_type?.startsWith('image') || asset.deliverable_type === 'generated_image' ? (
                      <div className="aspect-square overflow-hidden bg-gray-900">
                        <img src={asset.file_url} alt={asset.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                      </div>
                    ) : asset.file_type?.startsWith('video') || asset.deliverable_type === 'generated_video' ? (
                      <div className="aspect-video bg-gray-900">
                        <video src={asset.file_url} className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="aspect-square bg-gray-900 flex items-center justify-center">
                        <span className="text-4xl">📎</span>
                      </div>
                    )}
                    <div className="p-3">
                      <p className="text-xs font-medium text-white truncate">{asset.title}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{new Date(asset.created_at).toLocaleDateString()}</p>
                      <div className="flex gap-2 mt-2">
                        <a href={asset.file_url} target="_blank" rel="noopener noreferrer"
                          className="text-xs text-blue-400 hover:text-blue-300">↗ Open</a>
                        <button onClick={() => navigator.clipboard.writeText(asset.file_url)}
                          className="text-xs text-gray-400 hover:text-white">Copy URL</button>
                        <button onClick={() => deleteAsset(asset)}
                          className="text-xs text-red-400 hover:text-red-300 ml-auto">Delete</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'brand' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-300">Brand Guidelines</h3>
              {selectedProjectId && (
                <button onClick={() => setEditingBrand(!editingBrand)}
                  className={`text-xs px-3 py-1.5 rounded-lg ${editingBrand ? 'bg-gray-700 text-gray-300' : 'bg-purple-600 hover:bg-purple-700 text-white'}`}>
                  {editingBrand ? 'Cancel' : brandGuide ? '✏️ Edit' : '+ Create'}
                </button>
              )}
            </div>

            {!selectedProjectId ? (
              <div className="text-center py-16 text-gray-500">
                <p className="text-4xl mb-3">🎨</p>
                <p className="text-sm">Select a project to manage brand guidelines</p>
              </div>
            ) : editingBrand ? (
              <div className="bg-gray-800 rounded-xl p-6 border border-gray-700 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { key: 'brand_name', label: 'Brand Name', placeholder: 'Acme Corp' },
                    { key: 'target_audience', label: 'Target Audience', placeholder: 'B2B SaaS companies' },
                    { key: 'primary_colors', label: 'Primary Colors', placeholder: '#1a1a2e, #16213e' },
                    { key: 'secondary_colors', label: 'Secondary Colors', placeholder: '#0f3460, #e94560' },
                    { key: 'fonts', label: 'Fonts', placeholder: 'Primary: Inter, Secondary: Playfair' },
                    { key: 'brand_tone', label: 'Brand Tone', placeholder: 'Professional, authoritative, approachable' },
                  ].map(f => (
                    <div key={f.key}>
                      <label className="block text-xs text-gray-400 mb-1">{f.label}</label>
                      <input value={brandForm[f.key]} onChange={e => setBrandForm({...brandForm, [f.key]: e.target.value})}
                        className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                        placeholder={f.placeholder} />
                    </div>
                  ))}
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Brand Positioning</label>
                  <textarea value={brandForm.brand_positioning} onChange={e => setBrandForm({...brandForm, brand_positioning: e.target.value})}
                    className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500 resize-none" rows={3} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Logo</label>
                    <div className="flex items-center gap-3">
                      {brandForm.logo_url && <img src={brandForm.logo_url} alt="Logo" className="w-10 h-10 object-contain bg-white rounded p-1" />}
                      <input ref={logoRef} type="file" onChange={async e => {
                        const file = e.target.files?.[0]
                        if (!file) return
                        const fileName = `${selectedProjectId}/logo_${Date.now()}.${file.name.split('.').pop()}`
                        const { error } = await supabase.storage.from('sphere-deliverables').upload(fileName, file)
                        if (!error) {
                          const { data } = supabase.storage.from('sphere-deliverables').getPublicUrl(fileName)
                          setBrandForm(f => ({ ...f, logo_url: data.publicUrl }))
                        }
                      }} className="hidden" accept="image/*,.svg" />
                      <button onClick={() => logoRef.current?.click()}
                        className="bg-gray-700 hover:bg-gray-600 text-white text-xs px-3 py-2 rounded-lg">
                        {brandForm.logo_url ? 'Replace' : 'Upload Logo'}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Guidelines Doc URL</label>
                    <input value={brandForm.guidelines_url} onChange={e => setBrandForm({...brandForm, guidelines_url: e.target.value})}
                      className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                      placeholder="Google Drive / Notion link" />
                  </div>
                </div>
                <div className="flex gap-3">
                  <button onClick={saveBrandGuide} disabled={savingBrand}
                    className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium">
                    {savingBrand ? 'Saving...' : 'Save Brand Guide'}
                  </button>
                  <button onClick={() => setEditingBrand(false)} className="text-gray-400 text-sm hover:text-white px-3">Cancel</button>
                </div>
              </div>
            ) : brandGuide ? (
              <div className="space-y-4">
                <div className="bg-gray-800 rounded-xl p-5 border border-gray-700 flex items-center gap-4">
                  {brandForm.logo_url && <img src={brandForm.logo_url} alt="Logo" className="w-14 h-14 object-contain bg-white rounded-xl p-1.5" />}
                  <div>
                    <h3 className="text-xl font-bold text-white">{brandForm.brand_name}</h3>
                    <p className="text-sm text-gray-400 mt-1">{brandForm.brand_positioning}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Colors</h4>
                    {brandForm.primary_colors && (
                      <div className="flex gap-2 flex-wrap mb-2">
                        {brandForm.primary_colors.split(',').map(c => (
                          <div key={c} className="flex items-center gap-1.5">
                            <div className="w-5 h-5 rounded-full border border-gray-600" style={{ backgroundColor: c.trim() }} />
                            <span className="text-xs text-gray-300">{c.trim()}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {brandForm.secondary_colors && (
                      <div className="flex gap-2 flex-wrap">
                        {brandForm.secondary_colors.split(',').map(c => (
                          <div key={c} className="flex items-center gap-1.5">
                            <div className="w-4 h-4 rounded-full border border-gray-600 opacity-70" style={{ backgroundColor: c.trim() }} />
                            <span className="text-xs text-gray-400">{c.trim()}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Voice & Type</h4>
                    {brandForm.fonts && <p className="text-xs text-gray-300 mb-2">{brandForm.fonts}</p>}
                    {brandForm.brand_tone && <p className="text-xs bg-gray-700 text-gray-300 px-3 py-2 rounded-lg">{brandForm.brand_tone}</p>}
                  </div>
                  {brandForm.target_audience && (
                    <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                      <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Audience</h4>
                      <p className="text-sm text-gray-300">{brandForm.target_audience}</p>
                    </div>
                  )}
                  {brandForm.guidelines_url && (
                    <div className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                      <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Resources</h4>
                      <a href={brandForm.guidelines_url} target="_blank" rel="noopener noreferrer"
                        className="text-sm text-blue-400 hover:text-blue-300">📄 Guidelines Doc →</a>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-center py-16 text-gray-500">
                <p className="text-4xl mb-3">🎨</p>
                <p className="text-sm">No brand guide yet</p>
                <button onClick={() => setEditingBrand(true)}
                  className="mt-4 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm">
                  + Create Brand Guide
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
