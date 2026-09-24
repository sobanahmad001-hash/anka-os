// Evidence only, not account availability or execution authorization.
// https://open.higgsfield.ai/models/bytedance/seedance-2.5/text-to-video/api-reference
export const SEEDANCE = Object.freeze({
  provider: 'higgsfield', model: 'bytedance/seedance-2.5/text-to-video',
  resolutions: Object.freeze(['480p', '720p']),
  aspectRatios: Object.freeze(['16:9', '4:3', '1:1', '3:4', '9:16', '21:9']),
})

export function videoResolutionOptions(mode) {
  if (!['explore', 'production'].includes(mode)) throw new Error('Choose Explore or Production.')
  return (mode === 'explore' ? ['480p', '720p'] : ['720p', '1080p']).map(value => ({
    value, supported: SEEDANCE.resolutions.includes(value),
    label: value === '1080p' ? '1080p — unsupported by Seedance 2.5' : value,
  }))
}

// Pure adapter: shared server job owner must authorize, reserve and dispatch.
// No credentials, network, SDK, persistence, retries or execution permission.
export function describeSeedanceRequest({ mode, prompt, resolution, duration, aspectRatio,
  outputFormat = 'mp4', generateAudio = false }) {
  if (!videoResolutionOptions(mode).some(option => option.value === resolution && option.supported)) {
    throw new Error('Unsupported resolution. Choose explicitly; no fallback was applied.')
  }
  if (typeof prompt !== 'string' || !prompt.trim()) throw new Error('A prompt is required.')
  if (!Number.isInteger(duration) || duration < 4 || duration > 30) throw new Error('Duration must be 4–30 whole seconds.')
  if (mode === 'explore' && duration > 5) throw new Error('Explore previews are limited to 5 seconds.')
  if (!SEEDANCE.aspectRatios.includes(aspectRatio)) throw new Error('Unsupported aspect ratio.')
  if (!['mp4', 'mov'].includes(outputFormat)) throw new Error('Unsupported output format.')
  if (typeof generateAudio !== 'boolean') throw new Error('Choose whether to generate audio.')
  return { provider: SEEDANCE.provider, model: SEEDANCE.model,
    input: { prompt: prompt.trim(), duration, resolution, aspect_ratio: aspectRatio,
      output_format: outputFormat, generate_audio: generateAudio } }
}
