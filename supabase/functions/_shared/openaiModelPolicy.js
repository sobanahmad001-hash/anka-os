// Approved text-only policy. This catalog grants no account access or spend authority.
// Official model/Responses/caching documentation verified 2026-10-02.
export const OPENAI_ROUTINE_MODEL = 'gpt-6-luna'
export const OPENAI_SUBSTANTIVE_MODEL = 'gpt-6.1-sol'
export const OPENAI_PREMIUM_MODEL = 'gpt-6-astra'
export const OPENAI_TEXT_MODELS = Object.freeze([
  Object.freeze({ id: OPENAI_ROUTINE_MODEL, label: 'GPT-6 Luna', role: 'Routine chat and helpers' }),
  Object.freeze({ id: OPENAI_SUBSTANTIVE_MODEL, label: 'GPT-6.1 Sol', role: 'Drafting, analysis and planning' }),
  Object.freeze({ id: OPENAI_PREMIUM_MODEL, label: 'GPT-6 Astra', role: 'Premium explicit choice' }),
])
export function isApprovedOpenAiModel(model) {
  return OPENAI_TEXT_MODELS.some(item => item.id === model)
}
export function openAiTextOptions(model, workload = 'routine') {
  if (!isApprovedOpenAiModel(model)) return {}
  return { reasoning: { effort: workload === 'substantive' ? 'medium' : 'low' }, service_tier: 'default' }
}
export function requireAutomaticTextModel(model) {
  if (model === OPENAI_PREMIUM_MODEL) throw new Error('GPT-6 Astra requires an explicit chat or generation model choice; automatic routes cannot use it')
}
export function preferredApprovedModel(models, workload = 'routine') {
  const automatic = models.filter(item => item.model_id !== OPENAI_PREMIUM_MODEL)
  const preferred = workload === 'substantive' ? OPENAI_SUBSTANTIVE_MODEL : OPENAI_ROUTINE_MODEL
  return automatic.find(item => item.model_id === preferred)
    || automatic.find(item => item.is_default) || automatic[0]
}
export function openAiModelLabel(id) {
  const model = OPENAI_TEXT_MODELS.find(item => item.id === id)
  return model ? `${model.label} (${id})${id === OPENAI_PREMIUM_MODEL ? ' — Premium' : ''}` : id
}
