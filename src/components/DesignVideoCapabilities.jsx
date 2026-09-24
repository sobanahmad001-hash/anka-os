import { useState } from 'react'
import { videoResolutionOptions } from '../data/designMediaCapabilities.js'

export default function DesignVideoCapabilities() {
  const [mode, setMode] = useState('explore')
  const [resolution, setResolution] = useState('720p')
  const options = videoResolutionOptions(mode)
  const supported = options.some(option => option.value === resolution && option.supported)
  return <details className="mt-3 rounded-xl border border-white/10 p-3 text-xs text-slate-400">
    <summary className="cursor-pointer font-semibold text-slate-200">Video capabilities · generation unavailable</summary>
    <p className="mt-2">Higgsfield Seedance 2.5 supports 480p and 720p. Account access and the generation workflow are not verified. Google media is not configured.</p>
    <div className="mt-3 flex flex-wrap gap-3">
      <label>Mode <select className="rounded bg-slate-900 p-2" value={mode} onChange={event => { setMode(event.target.value); setResolution('') }}>
        <option value="explore">Explore</option><option value="production">Production</option>
      </select></label>
      <label>Resolution <select className="rounded bg-slate-900 p-2" value={resolution} onChange={event => setResolution(event.target.value)}>
        <option value="">Choose resolution</option>{options.map(option => <option key={option.value} value={option.value} disabled={!option.supported}>{option.label}</option>)}
      </select></label>
    </div>
    <p className="mt-2" role="status">{!supported ? 'Choose a supported resolution explicitly.' : `${resolution} is documented; generation remains unavailable.`} {mode === 'explore' ? 'Explore is limited to previews up to 5 seconds; cost must be confirmed before execution.' : '1080p is recommended for final output but unavailable on this model. No automatic downgrade or upscale is offered.'}</p>
    <p className="mt-2">Check the Asset Library and existing templates before generating. For text, logo, date or caption corrections, preserve original footage and edit the affected layer; video assembly is not yet available here.</p>
  </details>
}
