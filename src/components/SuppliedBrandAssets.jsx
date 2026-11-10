import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase.js'

const bucket = 'sphere-deliverables'
async function digest(blob) {
  const bytes = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(bytes), value => value.toString(16).padStart(2, '0')).join('')
}

export default function SuppliedBrandAssets({ project }) {
  const [assets, setAssets] = useState([])
  const [file, setFile] = useState(null)
  const [statement, setStatement] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [revision, setRevision] = useState(0)
  const [opened, setOpened] = useState(null)
  const input = useRef(null)
  const flight = useRef(false)
  useEffect(() => {
    let active = true
    supabase.from('brand_supplied_assets')
      .select('file_id,owner_statement,files!inner(file_name,storage_path,checksum,archived_at)')
      .eq('project_id', project.id).eq('organization_id', project.organization_id)
      .is('files.archived_at', null).order('recorded_at', { ascending: false })
      .then(({ data, error: readError }) => {
        if (active) {
          if (readError) setError(readError.message)
          else setAssets(data)
        }
      })
    return () => { active = false }
  }, [project.id, project.organization_id, revision])

  async function save(event) {
    event.preventDefault()
    if (!file || !statement.trim() || flight.current) return
    flight.current = true
    setSaving(true)
    setError('')
    try {
      const hash = await digest(file)
      const path = project.id + '/supplied-brand/' + hash
      const storage = supabase.storage.from(bucket)
      const existing = assets.find(asset => asset.files.checksum === hash)
      if (!existing) {
        const result = await storage.upload(path, file, { upsert: false, contentType: file.type || undefined })
        if (result.error) {
          if (!['409','Duplicate','ResourceAlreadyExists'].includes(String(result.error.statusCode)) && Number(result.error.status)!==409) throw result.error
          const previous = await storage.download(path)
          if (previous.error || await digest(previous.data) !== hash) throw Error('Could not verify the previously uploaded file.')
        }
      }
      const { error: saveError } = await supabase.rpc('register_supplied_brand_asset', {
        p_project: project.id, p_organization: project.organization_id, p_sha256: hash,
        p_name: file.name, p_statement: statement.trim(),
      })
      if (saveError) throw saveError
      input.current.value = ''
      setFile(null)
      setStatement('')
      setRevision(value => value + 1)
    } catch (cause) {
      setError(cause.message)
    } finally {
      flight.current = false
      setSaving(false)
    }
  }
  async function open(asset) {
    setError('')
    const { data, error: readError } = await supabase.storage.from(bucket).createSignedUrl(asset.files.storage_path, 60)
    if (readError) setError(readError.message)
    else setOpened({ id: asset.file_id, url: data.signedUrl })
  }
  return <section className="workspace-card p-4" aria-label="Existing brand assets">
    <h2>Existing brand assets</h2>
    <form onSubmit={save}>
      <label>Existing project file<input type="file" ref={input} onChange={e => setFile(e.target.files[0] || null)} /></label>
      <label>Owner-reported approval and use<textarea maxLength={2000} value={statement} onChange={e => setStatement(e.target.value)} /></label>
      <button className="workspace-button" disabled={saving || !file || !statement.trim()}>Register existing asset</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {assets.map(asset => <article key={asset.file_id}>
      <h3>{asset.files.file_name}</h3><p>Owner-reported history · {asset.owner_statement}</p>
      <button type="button" onClick={() => open(asset)}>Retrieve supplied file</button>
      {opened?.id === asset.file_id && <a href={opened.url}>Open supplied file</a>}
    </article>)}
  </section>
}
