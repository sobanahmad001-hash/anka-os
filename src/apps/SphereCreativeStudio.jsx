import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../context/AuthContext.jsx'

const HF_TOKEN = import.meta.env.VITE_HUGGING_FACE_TOKEN
const GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY

const IMAGE_PROVIDERS = [
  { id: 'pollinations', label: 'Pollinations', badge: 'Free · No key', color: 'bg-green-900/50 text-green-300' },
  { id: 'huggingface', label: 'Hugging Face', badge: 'Needs proxy', color: 'bg-gray-700 text-gray-400', disabled: true },
  { id: 'gemini', label: 'Google Imagen', badge: 'Free tier', color: 'bg-blue-900/50 text-blue-300' },
  { id: 'dalle', label: 'DALL-E 3', badge: 'Paid', color: 'bg-gray-700 text-gray-400' },
]

const VIDEO_PROVIDERS = [
  { id: 'huggingface_video', label: 'HuggingFace', badge: 'Needs proxy', color: 'bg-gray-700 text-gray-400', disabled: true },
  { id: 'runway', label: 'Runway ML', badge: '125 free credits', color: 'bg-purple-900/50 text-purple-300' },
  { id: 'veo', label: 'Google Veo', badge: 'Coming soon', color: 'bg-gray-700 text-gray-400', disabled: true },
]

const IMAGE_STYLES = [
  'photorealistic', 'cinematic', 'illustration', 'minimalist',
  'brand identity', 'social media', 'product shot', 'abstract',
]

const ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4']

async function generatePollinations(prompt, width, height) {
  const encoded = encodeURIComponent(prompt)
  const seed = Math.floor(Math.random() * 999999)
  const url = `https://image.pollinations.ai/prompt/${encoded}?width=${width}&height=${height}&nologo=true&enhance=true&seed=${seed}`
  await new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = resolve
    img.onerror = reject
    img.src = url
  })
  return { url, provider: 'pollinations' }
}

async function generateHuggingFace(prompt, model) {
  throw new Error('HuggingFace requires a backend proxy due to CORS. Use Pollinations or Google Imagen instead — or we can add a Supabase Edge Function to proxy HF requests.')
}

async function generateGemini(prompt) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt: prompt }],
        parameters: { sampleCount: 1 },
      }),
    }
  )
  if (!response.ok) throw new Error(`Gemini error: ${response.status}`)
  const data = await response.json()
  const imageB64 = data.predictions?.[0]?.bytesBase64Encoded
  if (!imageB64) throw new Error('No image in Gemini response')
  const url = `data:image/png;base64,${imageB64}`
  return { url, provider: 'gemini' }
}

async function generateHFVideo(prompt) {
  throw new Error("HuggingFace video requires a backend proxy. We'll add this via Supabase Edge Function in the next sprint.")
}

function getDimensions(ratio) {
  const map = {
    '1:1': [1024, 1024],
    '16:9': [1280, 720],
    '9:16': [720, 1280],
    '4:3': [1024, 768],
    '3:4': [768, 1024],
  }
  return map[ratio] || [1024, 1024]
}

export default function SphereCreativeStudio() {
  const { user, profile } = useAuth()
  const [activeTab, setActiveTab] = useState('image')
  const [projects, setProjects] = useState([])
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [assets, setAssets] = useState([])
  const [brandGuide, setBrandGuide] = useState(null)
  const [assetsLoading, setAssetsLoading] = useState(false)

  // Image generation state
  const [imageProvider, setImageProvider] = useState('pollinations')
  const [imagePrompt, setImagePrompt] = useState('')
  const [imageStyle, setImageStyle] = useState('')
  const [aspectRatio, setAspectRatio] = useState('1:1')
  const [generatedImages, setGeneratedImages] = useState([])
  const [imageLoading, setImageLoading] = useState(false)
  const [imageError, setImageError] = useState('')
  const [hfModel, setHfModel] = useState('black-forest-labs/FLUX.1-schnell')

  // Video generation state
  const [videoProvider, setVideoProvider] = useState('huggingface_video')
  const [videoPrompt, setVideoPrompt] = useState('')
  const [generatedVideos, setGeneratedVideos] = useState([])
  const [videoLoading, setVideoLoading] = useState(false)
  const [videoError, setVideoError] = useState('')

  // Brand guide state
  const [editingBrand, setEditingBrand] = useState(false)
  const [brandForm, setBrandForm] = useState({
    brand_name: '', primary_colors: '', secondary_colors: '',
    fonts: '', brand_tone: '', target_audience: '', brand_positioning: '',
    logo_url: '', guidelines_url: ''
  })
  const [savingBrand, setSavingBrand] = useState(false)

  // Upload
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
      .select('*')
      .eq('project_id', selectedProjectId)
      .in('deliverable_type', ['image', 'video', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'mp4', 'mov', 'generated_image', 'generated_video'])
      .order('created_at', { ascending: false })
    setAssets(data || [])
    setAssetsLoading(false)
  }

  async function fetchBrandGuide() {
    const { data } = await supabase.from('as_project_documents')
      .select('*').eq('project_id', selectedProjectId).eq('doc_type', 'brand_identity').single()
    if (data) {
      setBrandGuide(data)
      try {
        const parsed = JSON.parse(data.content)
        setBrandForm(parsed)
      } catch {
        setBrandForm(f => ({ ...f, brand_name: data.title }))
      }
    }
  }

  async function saveToAssetLibrary(url, blob, type, title) {
    if (!selectedProjectId) return
    try {
      let finalUrl = url
      if (blob) {
        const ext = type === 'video' ? 'mp4' : 'png'
        const fileName = `${selectedProjectId}/${Date.now()}.${ext}`
        const { error } = await supabase.storage
          .from('sphere-deliverables').upload(fileName, blob)
        if (!error) {
          const { data: urlData } = supabase.storage
            .from('sphere-deliverables').getPublicUrl(fileName)
          finalUrl = urlData.publicUrl
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
    } catch (err) {
      console.error('Save error:', err)
    }
  }

  async function generateImage() {
    if (!imagePrompt.trim()) return
    setImageLoading(true)
    setImageError('')
    const fullPrompt = imageStyle ? `${imagePrompt}, ${imageStyle} style` : imagePrompt
    const [w, h] = getDimensions(aspectRatio)
    try {
      let result
      if (imageProvider === 'pollinations') result = await generatePollinations(fullPrompt, w, h)
      else if (imageProvider === 'huggingface') result = await generateHuggingFace(fullPrompt, hfModel)
      else if (imageProvider === 'gemini') result = await generateGemini(fullPrompt)
      else { setImageError('Provider not configured yet'); setImageLoading(false); return }
      setGeneratedImages(prev => [{ ...result, prompt: fullPrompt, ratio: aspectRatio, ts: Date.now() }, ...prev.slice(0, 7)])
    } catch (err) {
      setImageError(err.message)
    }
    setImageLoading(false)
  }

  async function generateVideo() {
    if (!videoPrompt.trim()) return
    setVideoLoading(true)
    setVideoError('')
    try {
      let result
      if (videoProvider === 'huggingface_video') result = await generateHFVideo(videoPrompt)
      else { setVideoError('Provider not configured yet'); setVideoLoading(false); return }
      setGeneratedVideos(prev => [{ ...result, prompt: videoPrompt, ts: Date.now() }, ...prev.slice(0, 5)])
    } catch (err) {
      setVideoError(err.message)
    }
    setVideoLoading(false)
  }

  async function handleAssetUpload(e) {
    const file = e.target.files?.[0]
    if (!file || !selectedProjectId) return
    setUploadingAsset(true)
    const ext = file.name.split('.').pop()
    const fileName = `${selectedProjectId}/${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('sphere-deliverables').upload(fileName, file)
    if (!error) {
      const { data: urlData } = supabase.storage.from('sphere-deliverables').getPublicUrl(fileName)
      await supabase.from('as_deliverables').insert({
        project_id: selectedProjectId, phase: 'product_modeling',
        title: file.name, file_url: urlData.publicUrl,
        deliverable_type: ext, file_type: file.type,
        file_size: file.size, created_by: user?.id, uploaded_by: user?.id
      })
      fetchAssets()
    }
    setUploadingAsset(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleLogoUpload(e) {
    const file = e.target.files?.[0]
    if (!file || !selectedProjectId) return
    const fileName = `${selectedProjectId}/logo_${Date.now()}.${file.name.split('.').pop()}`
    const { error } = await supabase.storage.from('sphere-deliverables').upload(fileName, file)
    if (!error) {
      const { data: urlData } = supabase.storage.from('sphere-deliverables').getPublicUrl(fileName)
      setBrandForm(f => ({ ...f, logo_url: urlData.publicUrl }))
    }
    if (logoRef.current) logoRef.current.value = ''
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
    if (asset.file_url) {
      const path = asset.file_url.split('sphere-deliverables/')[1]
      if (path) await supabase.storage.from('sphere-deliverables').remove([path])
    }
    await supabase.from('as_deliverables').delete().eq('id', asset.id)
    fetchAssets()
  }

  const HF_IMAGE_MODELS = [
    { id: 'black-forest-labs/FLUX.1-schnell', label: 'FLUX Schnell (Fast)' },
    { id: 'black-forest-labs/FLUX.1-dev', label: 'FLUX Dev (Quality)' },
    { id: 'stabilityai/stable-diffusion-xl-base-1.0', label: 'SDXL (Stable)' },
    { id: 'runwayml/stable-diffusion-v1-5', label: 'SD 1.5 (Classic)' },
  ]

  return (
    <div className="flex flex-col h-full bg-gray-950 text-white">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-white">Creative Studio</h2>
          <p className="text-xs text-gray-400 mt-0.5">AI image & video generation · Asset library · Brand guidelines</p>
        </div>
        <select value={selectedProjectId} onChange={e => setSelectedProjectId(e.target.value)}
          className="bg-gray-800 text-gray-300 text-xs rounded-lg px-3 py-2 border border-gray-700 focus:outline-none focus:ring-1 focus:ring-purple-500">
          <option value="">Select project</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name}{p.as_clients?.name ? ` · ${p.as_clients.name}` : ''}</option>
          ))}
        </select>
      </div>

      {/* Tabs */}
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

        {/* IMAGE GENERATION */}
        {activeTab === 'image' && (
          <div className="space-y-5">
            {/* Provider selector */}
            <div>
              <label className="block text-xs text-gray-400 uppercase tracking-wide mb-2">Provider</label>
              <div className="flex gap-2 flex-wrap">
                {IMAGE_PROVIDERS.map(p => (
                  <button key={p.id} onClick={() => !p.disabled && setImageProvider(p.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all ${
                      imageProvider === p.id ? 'border-purple-500 bg-purple-900/20' :
                      p.disabled ? 'border-gray-700 opacity-40 cursor-not-allowed' :
                      'border-gray-700 hover:border-gray-600 bg-gray-800'
                    }`}>
                    <span className="text-sm font-medium text-white">{p.label}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${p.color}`}>{p.badge}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* HF model selector */}
            {imageProvider === 'huggingface' && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">Model</label>
                <select value={hfModel} onChange={e => setHfModel(e.target.value)}
                  className="bg-gray-800 text-white text-xs rounded-lg px-3 py-2 border border-gray-700 focus:outline-none focus:ring-1 focus:ring-purple-500">
                  {HF_IMAGE_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
            )}

            {/* Controls */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Style</label>
                <select value={imageStyle} onChange={e => setImageStyle(e.target.value)}
                  className="w-full bg-gray-800 text-white text-sm rounded-xl px-3 py-2 border border-gray-700 focus:outline-none focus:ring-1 focus:ring-purple-500">
                  <option value="">No style</option>
                  {IMAGE_STYLES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1">Aspect Ratio</label>
                <div className="flex gap-1">
                  {ASPECT_RATIOS.map(r => (
                    <button key={r} onClick={() => setAspectRatio(r)}
                      className={`flex-1 py-2 text-xs rounded-lg transition-colors ${aspectRatio === r ? 'bg-purple-600 text-white' : 'bg-gray-800 text-gray-400 hover:text-white border border-gray-700'}`}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Prompt */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Prompt</label>
              <div className="flex gap-2">
                <textarea value={imagePrompt} onChange={e => setImagePrompt(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && e.ctrlKey && generateImage()}
                  className="flex-1 bg-gray-800 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 border border-gray-700 resize-none"
                  rows={3} placeholder="Describe the image you want to create... (Ctrl+Enter to generate)" />
                <button onClick={generateImage} disabled={imageLoading || !imagePrompt.trim()}
                  className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-5 rounded-xl text-sm font-medium transition-colors flex-shrink-0">
                  {imageLoading ? (
                    <span className="flex flex-col items-center gap-1">
                      <span className="animate-spin text-lg">⏳</span>
                      <span className="text-xs">Gen...</span>
                    </span>
                  ) : '✨ Generate'}
                </button>
              </div>
            </div>

            {/* Quick prompts */}
            <div>
              <p className="text-xs text-gray-500 mb-2">Quick prompts</p>
              <div className="flex gap-2 flex-wrap">
                {[
                  'Professional brand logo on white background',
                  'Modern website hero background, abstract geometric',
                  'Social media post template, clean minimal design',
                  'Product lifestyle photography, luxury feel',
                  'Corporate team photo background',
                  'Instagram story template, bold typography',
                ].map(s => (
                  <button key={s} onClick={() => setImagePrompt(s)}
                    className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg border border-gray-700 transition-colors">
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Error */}
            {imageError && (
              <div className="bg-red-900/30 border border-red-700/50 rounded-xl p-3">
                <p className="text-xs text-red-300">❌ {imageError}</p>
                {imageError.includes('loading') && (
                  <p className="text-xs text-red-400 mt-1">Model is warming up — wait 20 seconds and try again</p>
                )}
              </div>
            )}

            {/* Generated images */}
            {generatedImages.length > 0 && (
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-3">Generated ({generatedImages.length})</p>
                <div className="grid grid-cols-2 gap-4">
                  {generatedImages.map((img, i) => (
                    <div key={img.ts} className="bg-gray-800 rounded-xl overflow-hidden border border-gray-700">
                      <img src={img.url} alt={img.prompt}
                        crossOrigin="anonymous"
                        onError={e => e.target.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="%23374151"/><text x="50" y="50" text-anchor="middle" fill="%239CA3AF" font-size="12">Loading...</text></svg>'}
                        className="w-full object-cover"
                        style={{ aspectRatio: img.ratio?.replace(':', '/') || '1/1' }} />
                      <div className="p-3">
                        <p className="text-xs text-gray-400 line-clamp-2 mb-2">{img.prompt}</p>
                        <div className="flex items-center gap-2">
                          <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded capitalize">{img.provider}</span>
                          <span className="text-xs text-gray-500">{img.ratio}</span>
                          <div className="ml-auto flex gap-2">
                            <a href={img.url} download={`generated_${img.ts}.png`} target="_blank" rel="noopener noreferrer"
                              className="text-xs text-blue-400 hover:text-blue-300">↓ Save</a>
                            {selectedProjectId && (
                              <button onClick={() => saveToAssetLibrary(img.url, img.blob, 'image', img.prompt.slice(0, 50))}
                                className="text-xs text-green-400 hover:text-green-300">+ Library</button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {imageLoading && (
              <div className="flex flex-col items-center justify-center py-16 text-gray-500">
                <div className="text-4xl mb-3 animate-pulse">🎨</div>
                <p className="text-sm">Generating your image...</p>
                <p className="text-xs mt-1 text-gray-600">
                  {imageProvider === 'huggingface' ? 'HuggingFace may take 20-60 seconds' :
                   imageProvider === 'gemini' ? 'Gemini usually takes 5-15 seconds' :
                   'Pollinations usually takes 3-8 seconds'}
                </p>
              </div>
            )}
          </div>
        )}

        {/* VIDEO GENERATION */}
        {activeTab === 'video' && (
          <div className="space-y-5">
            {/* Provider selector */}
            <div>
              <label className="block text-xs text-gray-400 uppercase tracking-wide mb-2">Provider</label>
              <div className="flex gap-2 flex-wrap">
                {VIDEO_PROVIDERS.map(p => (
                  <button key={p.id} onClick={() => !p.disabled && setVideoProvider(p.id)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all ${
                      videoProvider === p.id ? 'border-purple-500 bg-purple-900/20' :
                      p.disabled ? 'border-gray-700 opacity-40 cursor-not-allowed' :
                      'border-gray-700 hover:border-gray-600 bg-gray-800'
                    }`}>
                    <span className="text-sm font-medium text-white">{p.label}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${p.color}`}>{p.badge}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Runway info */}
            {videoProvider === 'runway' && (
              <div className="bg-purple-900/20 border border-purple-700/50 rounded-xl p-4">
                <p className="text-sm font-medium text-purple-300 mb-1">Runway ML</p>
                <p className="text-xs text-gray-400 mb-3">Runway offers 125 free credits on signup. Add your API key to use it here.</p>
                <input placeholder="Enter Runway API key..."
                  className="w-full bg-gray-800 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500 border border-gray-700" />
                <a href="https://runwayml.com" target="_blank" rel="noopener noreferrer"
                  className="text-xs text-purple-400 hover:text-purple-300 mt-2 block">Get free credits at runwayml.com →</a>
              </div>
            )}

            {/* Prompt */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Video Prompt</label>
              <div className="flex gap-2">
                <textarea value={videoPrompt} onChange={e => setVideoPrompt(e.target.value)}
                  className="flex-1 bg-gray-800 text-white rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 border border-gray-700 resize-none"
                  rows={3} placeholder="Describe the video you want to generate... Keep it simple for best results" />
                <button onClick={generateVideo} disabled={videoLoading || !videoPrompt.trim() || videoProvider === 'runway'}
                  className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white px-5 rounded-xl text-sm font-medium transition-colors flex-shrink-0">
                  {videoLoading ? (
                    <span className="flex flex-col items-center gap-1">
                      <span className="animate-spin text-lg">⏳</span>
                      <span className="text-xs">Gen...</span>
                    </span>
                  ) : '🎥 Generate'}
                </button>
              </div>
            </div>

            {/* Quick prompts */}
            <div>
              <p className="text-xs text-gray-500 mb-2">Quick prompts</p>
              <div className="flex gap-2 flex-wrap">
                {[
                  'A car driving through city streets at night',
                  'Abstract flowing particles, brand colors',
                  'Professional business meeting timelapse',
                  'Product rotating on clean background',
                ].map(s => (
                  <button key={s} onClick={() => setVideoPrompt(s)}
                    className="text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded-lg border border-gray-700">
                    {s}
                  </button>
                ))}
              </div>
            </div>

            {/* Warning */}
            <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
              <p className="text-xs text-gray-400">
                <span className="text-yellow-400 font-medium">⚠ Note:</span> Free video generation via HuggingFace produces short clips (2-4 seconds) at lower resolution. Quality improves significantly with Runway ML. Google Veo integration coming when API becomes available.
              </p>
            </div>

            {/* Error */}
            {videoError && (
              <div className="bg-red-900/30 border border-red-700/50 rounded-xl p-3">
                <p className="text-xs text-red-300">❌ {videoError}</p>
              </div>
            )}

            {/* Generated videos */}
            {generatedVideos.length > 0 && (
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-3">Generated Videos</p>
                <div className="grid grid-cols-1 gap-4">
                  {generatedVideos.map(vid => (
                    <div key={vid.ts} className="bg-gray-800 rounded-xl overflow-hidden border border-gray-700">
                      <video src={vid.url} controls className="w-full" style={{ maxHeight: '300px' }} />
                      <div className="p-3">
                        <p className="text-xs text-gray-400 mb-2">{vid.prompt}</p>
                        <div className="flex items-center gap-2">
                          <span className="text-xs bg-gray-700 text-gray-300 px-2 py-0.5 rounded">{vid.provider}</span>
                          <div className="ml-auto flex gap-2">
                            <a href={vid.url} download={`video_${vid.ts}.mp4`}
                              className="text-xs text-blue-400 hover:text-blue-300">↓ Save</a>
                            {selectedProjectId && (
                              <button onClick={() => saveToAssetLibrary(vid.url, vid.blob, 'video', vid.prompt.slice(0, 50))}
                                className="text-xs text-green-400 hover:text-green-300">+ Library</button>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {videoLoading && (
              <div className="flex flex-col items-center justify-center py-16 text-gray-500">
                <div className="text-4xl mb-3 animate-pulse">🎥</div>
                <p className="text-sm">Generating video...</p>
                <p className="text-xs mt-1 text-gray-600">This can take 1-3 minutes on HuggingFace free tier</p>
              </div>
            )}
          </div>
        )}

        {/* ASSET LIBRARY */}
        {activeTab === 'assets' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-300">
                Asset Library {selectedProjectId ? `(${assets.length})` : '— select a project'}
              </h3>
              {selectedProjectId && (
                <div className="flex gap-2">
                  <input ref={fileRef} type="file" onChange={handleAssetUpload}
                    className="hidden" accept="image/*,video/*,.pdf,.ai,.psd,.fig,.sketch" />
                  <button onClick={() => fileRef.current?.click()}
                    disabled={uploadingAsset}
                    className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs px-3 py-1.5 rounded-lg transition-colors">
                    {uploadingAsset ? '⏳ Uploading...' : '↑ Upload Asset'}
                  </button>
                </div>
              )}
            </div>

            {!selectedProjectId ? (
              <div className="text-center py-16 text-gray-500">
                <p className="text-4xl mb-3">📁</p>
                <p className="text-sm">Select a project above to view its assets</p>
              </div>
            ) : assetsLoading ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-500" />
              </div>
            ) : (
              <div>
                {/* Filter tabs */}
                {assets.length > 0 && (
                  <div className="flex gap-2 mb-4">
                    {['all', 'generated_image', 'generated_video', 'uploaded'].map(f => {
                      const count = f === 'all' ? assets.length :
                        f === 'uploaded' ? assets.filter(a => !a.deliverable_type?.startsWith('generated')).length :
                        assets.filter(a => a.deliverable_type === f).length
                      return (
                        <button key={f}
                          className="px-3 py-1 text-xs rounded-full bg-gray-800 text-gray-400 hover:text-white border border-gray-700 capitalize">
                          {f.replace(/_/g, ' ')} ({count})
                        </button>
                      )
                    })}
                  </div>
                )}

                <div className="grid grid-cols-3 gap-4">
                  {assets.map(asset => (
                    <div key={asset.id} className="bg-gray-800 rounded-xl overflow-hidden border border-gray-700 group">
                      {asset.file_type?.startsWith('image') || asset.deliverable_type === 'generated_image' ? (
                        <div className="aspect-square overflow-hidden bg-gray-900">
                          <img src={asset.file_url} alt={asset.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                        </div>
                      ) : asset.file_type?.startsWith('video') || asset.deliverable_type === 'generated_video' ? (
                        <div className="aspect-video bg-gray-900 flex items-center justify-center">
                          <video src={asset.file_url} className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <div className="aspect-square bg-gray-900 flex items-center justify-center">
                          <span className="text-4xl">📎</span>
                        </div>
                      )}
                      <div className="p-3">
                        <p className="text-xs font-medium text-white truncate">{asset.title}</p>
                        <p className="text-xs text-gray-500 mt-0.5 capitalize">
                          {asset.deliverable_type?.replace(/_/g, ' ')} · {new Date(asset.created_at).toLocaleDateString()}
                        </p>
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
                {assets.length === 0 && (
                  <div className="text-center py-16 text-gray-500">
                    <p className="text-4xl mb-3">🖼️</p>
                    <p className="text-sm">No assets yet</p>
                    <p className="text-xs mt-1">Generate images or upload files to build the library</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* BRAND GUIDELINES */}
        {activeTab === 'brand' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-300">Brand Guidelines</h3>
              {selectedProjectId && (
                <button onClick={() => setEditingBrand(!editingBrand)}
                  className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${editingBrand ? 'bg-gray-700 text-gray-300' : 'bg-purple-600 hover:bg-purple-700 text-white'}`}>
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
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Brand Name</label>
                    <input value={brandForm.brand_name} onChange={e => setBrandForm({...brandForm, brand_name: e.target.value})}
                      className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Target Audience</label>
                    <input value={brandForm.target_audience} onChange={e => setBrandForm({...brandForm, target_audience: e.target.value})}
                      className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Primary Colors (hex codes)</label>
                    <input value={brandForm.primary_colors} onChange={e => setBrandForm({...brandForm, primary_colors: e.target.value})}
                      className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                      placeholder="#1a1a2e, #16213e" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Secondary Colors</label>
                    <input value={brandForm.secondary_colors} onChange={e => setBrandForm({...brandForm, secondary_colors: e.target.value})}
                      className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Fonts</label>
                    <input value={brandForm.fonts} onChange={e => setBrandForm({...brandForm, fonts: e.target.value})}
                      className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                      placeholder="Primary: Inter, Secondary: Playfair" />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Brand Tone</label>
                    <input value={brandForm.brand_tone} onChange={e => setBrandForm({...brandForm, brand_tone: e.target.value})}
                      className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-500"
                      placeholder="Professional, authoritative, approachable" />
                  </div>
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
                      {brandForm.logo_url && (
                        <img src={brandForm.logo_url} alt="Logo" className="w-12 h-12 object-contain bg-white rounded-lg p-1" />
                      )}
                      <input ref={logoRef} type="file" onChange={handleLogoUpload} className="hidden" accept="image/*,.svg" />
                      <button onClick={() => logoRef.current?.click()}
                        className="bg-gray-700 hover:bg-gray-600 text-white text-xs px-3 py-2 rounded-lg">
                        {brandForm.logo_url ? 'Replace Logo' : 'Upload Logo'}
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
                <div className="flex gap-3 pt-2">
                  <button onClick={saveBrandGuide} disabled={savingBrand}
                    className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium">
                    {savingBrand ? 'Saving...' : 'Save Brand Guide'}
                  </button>
                  <button onClick={() => setEditingBrand(false)} className="text-gray-400 text-sm hover:text-white px-3">Cancel</button>
                </div>
              </div>
            ) : brandGuide ? (
              <div className="space-y-4">
                {/* Brand header */}
                <div className="bg-gray-800 rounded-xl p-5 border border-gray-700 flex items-center gap-4">
                  {brandForm.logo_url && (
                    <img src={brandForm.logo_url} alt="Logo" className="w-16 h-16 object-contain bg-white rounded-xl p-2" />
                  )}
                  <div>
                    <h3 className="text-xl font-bold text-white">{brandForm.brand_name || 'Brand'}</h3>
                    <p className="text-sm text-gray-400 mt-1">{brandForm.brand_positioning}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Colors */}
                  <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Colors</h4>
                    <div className="space-y-2">
                      {brandForm.primary_colors && (
                        <div>
                          <p className="text-xs text-gray-500 mb-1">Primary</p>
                          <div className="flex gap-2 flex-wrap">
                            {brandForm.primary_colors.split(',').map(c => (
                              <div key={c} className="flex items-center gap-1.5">
                                <div className="w-6 h-6 rounded-full border border-gray-600" style={{ backgroundColor: c.trim() }} />
                                <span className="text-xs text-gray-300">{c.trim()}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {brandForm.secondary_colors && (
                        <div>
                          <p className="text-xs text-gray-500 mb-1">Secondary</p>
                          <div className="flex gap-2 flex-wrap">
                            {brandForm.secondary_colors.split(',').map(c => (
                              <div key={c} className="flex items-center gap-1.5">
                                <div className="w-6 h-6 rounded-full border border-gray-600" style={{ backgroundColor: c.trim() }} />
                                <span className="text-xs text-gray-300">{c.trim()}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Typography + tone */}
                  <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
                    <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Typography & Voice</h4>
                    {brandForm.fonts && <p className="text-sm text-gray-300 mb-2">{brandForm.fonts}</p>}
                    {brandForm.brand_tone && (
                      <p className="text-xs bg-gray-700 text-gray-300 px-3 py-2 rounded-lg">{brandForm.brand_tone}</p>
                    )}
                  </div>

                  {/* Audience */}
                  {brandForm.target_audience && (
                    <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
                      <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Target Audience</h4>
                      <p className="text-sm text-gray-300">{brandForm.target_audience}</p>
                    </div>
                  )}

                  {/* External links */}
                  {brandForm.guidelines_url && (
                    <div className="bg-gray-800 rounded-xl p-5 border border-gray-700">
                      <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Resources</h4>
                      <a href={brandForm.guidelines_url} target="_blank" rel="noopener noreferrer"
                        className="text-sm text-blue-400 hover:text-blue-300">📄 Brand Guidelines Doc →</a>
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
