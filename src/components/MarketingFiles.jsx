import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase.js'

const CHANNELS = ['all', 'seo', 'content', 'social', 'paid', 'analytics', 'general']

const CHANNEL_COLORS = {
  seo: 'bg-teal-900/50 text-teal-300',
  content: 'bg-amber-900/50 text-amber-300',
  social: 'bg-orange-900/50 text-orange-300',
  paid: 'bg-blue-900/50 text-blue-300',
  analytics: 'bg-green-900/50 text-green-300',
  general: 'bg-gray-700 text-gray-300',
}

export default function MarketingFiles({ projectId, userId }) {
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [filterChannel, setFilterChannel] = useState('all')
  const [uploadChannel, setUploadChannel] = useState('general')
  const [uploadTitle, setUploadTitle] = useState('')
  const [uploadNote, setUploadNote] = useState('')
  const fileRef = useRef(null)

  useEffect(() => { if (projectId) fetchFiles() }, [projectId, filterChannel])

  async function fetchFiles() {
    setLoading(true)
    let query = supabase.from('as_deliverables')
      .select('*')
      .eq('project_id', projectId)
      .not('marketing_channel', 'is', null)
      .order('created_at', { ascending: false })
    if (filterChannel !== 'all') {
      query = query.eq('marketing_channel', filterChannel)
    }
    const { data } = await query
    setFiles(data || [])
    setLoading(false)
  }

  async function handleUpload(e) {
    const selectedFiles = Array.from(e.target.files || [])
    if (!selectedFiles.length || !projectId) return
    setUploading(true)
    for (const file of selectedFiles) {
      const ext = file.name.split('.').pop().toLowerCase()
      const fileName = `${projectId}/marketing/${Date.now()}_${file.name.replace(/\s+/g, '_')}`
      const { error: uploadError } = await supabase.storage
        .from('sphere-deliverables').upload(fileName, file)
      if (!uploadError) {
        const { data: urlData } = supabase.storage
          .from('sphere-deliverables').getPublicUrl(fileName)
        await supabase.from('as_deliverables').insert({
          project_id: projectId,
          phase: 'marketing',
          title: uploadTitle || file.name,
          file_url: urlData.publicUrl,
          file_type: file.type,
          file_size: file.size,
          deliverable_type: ext,
          marketing_channel: uploadChannel,
          notes: uploadNote || null,
          created_by: userId,
          uploaded_by: userId,
        })
      }
    }
    setUploadTitle('')
    setUploadNote('')
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
    fetchFiles()
  }

  async function deleteFile(file) {
    if (file.file_url?.includes('sphere-deliverables')) {
      const path = file.file_url.split('sphere-deliverables/')[1]
      if (path) await supabase.storage.from('sphere-deliverables').remove([path])
    }
    await supabase.from('as_deliverables').delete().eq('id', file.id)
    setFiles(files.filter(f => f.id !== file.id))
  }

  function getFileIcon(file) {
    const type = file.file_type || ''
    const ext = file.deliverable_type || ''
    if (type.startsWith('image')) return '🖼️'
    if (type.startsWith('video')) return '🎥'
    if (type.includes('pdf') || ext === 'pdf') return '📄'
    if (['doc','docx'].includes(ext)) return '📝'
    if (['xls','xlsx','csv'].includes(ext)) return '📊'
    if (['ppt','pptx'].includes(ext)) return '📊'
    if (['zip','rar'].includes(ext)) return '📦'
    return '📎'
  }

  function formatSize(bytes) {
    if (!bytes) return ''
    if (bytes < 1024) return `${bytes}B`
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  }

  const grouped = CHANNELS.slice(1).reduce((acc, ch) => {
    const chFiles = files.filter(f => f.marketing_channel === ch)
    if (chFiles.length) acc[ch] = chFiles
    return acc
  }, {})

  return (
    <div className="space-y-5">
      {/* Upload area */}
      <div className="bg-gray-800 rounded-xl p-5 border border-dashed border-gray-600 space-y-4">
        <h4 className="text-sm font-semibold text-white">Upload Files</h4>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Channel</label>
            <select value={uploadChannel} onChange={e => setUploadChannel(e.target.value)}
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none">
              {CHANNELS.slice(1).map(c => (
                <option key={c} value={c} className="capitalize">{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Title (optional)</label>
            <input value={uploadTitle} onChange={e => setUploadTitle(e.target.value)}
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500"
              placeholder="e.g. Q1 Keyword Report" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Note (optional)</label>
            <input value={uploadNote} onChange={e => setUploadNote(e.target.value)}
              className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-purple-500"
              placeholder="Brief description" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <input ref={fileRef} type="file" multiple onChange={handleUpload}
            className="hidden"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp,.mp4,.mov,.zip,.txt,.ai,.psd,.fig,.sketch" />
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-sm px-4 py-2 rounded-lg transition-colors">
            {uploading ? '⏳ Uploading...' : '↑ Choose Files'}
          </button>
          <p className="text-xs text-gray-500">PDF, Word, Excel, CSV, images, videos, designs — multiple files supported</p>
        </div>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2">
        <div className="flex gap-1 bg-gray-800 rounded-lg p-1">
          {CHANNELS.map(c => (
            <button key={c} onClick={() => setFilterChannel(c)}
              className={`px-3 py-1 text-xs rounded-md capitalize transition-colors ${filterChannel === c ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}>
              {c}
            </button>
          ))}
        </div>
        <span className="text-xs text-gray-500 ml-auto">{files.length} files</span>
      </div>

      {/* Files */}
      {loading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-purple-500" />
        </div>
      ) : filterChannel === 'all' ? (
        // Grouped by channel
        <div className="space-y-5">
          {Object.entries(grouped).map(([channel, chFiles]) => (
            <div key={channel}>
              <div className="flex items-center gap-2 mb-3">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${CHANNEL_COLORS[channel]}`}>{channel}</span>
                <span className="text-xs text-gray-500">{chFiles.length} files</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {chFiles.map(file => (
                  <FileCard key={file.id} file={file} onDelete={deleteFile} getIcon={getFileIcon} formatSize={formatSize} />
                ))}
              </div>
            </div>
          ))}
          {Object.keys(grouped).length === 0 && <EmptyFiles />}
        </div>
      ) : (
        // Filtered channel
        <div>
          {files.length > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              {files.map(file => (
                <FileCard key={file.id} file={file} onDelete={deleteFile} getIcon={getFileIcon} formatSize={formatSize} />
              ))}
            </div>
          ) : <EmptyFiles />}
        </div>
      )}
    </div>
  )
}

function FileCard({ file, onDelete, getIcon, formatSize }) {
  return (
    <div className="bg-gray-800 rounded-xl p-4 border border-gray-700 flex items-start gap-3 group">
      <div className="text-2xl flex-shrink-0">{getIcon(file)}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white truncate">{file.title || file.deliverable_type}</p>
        <div className="flex items-center gap-2 mt-0.5">
          {file.marketing_channel && (
            <span className={`text-xs px-1.5 py-0.5 rounded capitalize ${CHANNEL_COLORS[file.marketing_channel] || 'bg-gray-700 text-gray-400'}`}>
              {file.marketing_channel}
            </span>
          )}
          {file.file_size && <span className="text-xs text-gray-500">{formatSize(file.file_size)}</span>}
        </div>
        {file.notes && <p className="text-xs text-gray-500 mt-1 truncate">{file.notes}</p>}
        <p className="text-xs text-gray-600 mt-0.5">{new Date(file.created_at).toLocaleDateString()}</p>
      </div>
      <div className="flex flex-col gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {file.file_url && (
          <a href={file.file_url} target="_blank" rel="noopener noreferrer"
            className="text-xs text-blue-400 hover:text-blue-300">↗</a>
        )}
        <button onClick={() => onDelete(file)}
          className="text-xs text-red-400 hover:text-red-300">✕</button>
      </div>
    </div>
  )
}

function EmptyFiles() {
  return (
    <div className="text-center py-12 text-gray-500">
      <p className="text-4xl mb-3">📎</p>
      <p className="text-sm">No files uploaded yet</p>
      <p className="text-xs mt-1">Upload reports, creatives, keyword CSVs, ad assets</p>
    </div>
  )
}
