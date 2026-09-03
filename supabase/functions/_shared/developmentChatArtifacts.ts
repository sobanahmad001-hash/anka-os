type Json = Record<string, unknown>

export const CHAT_DEVELOPMENT_ARTIFACT_TYPE_SET = new Set(['technical_brief', 'launch_checklist'])

function text(value: unknown, max = 12000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

export function validateDevelopmentChatArtifact(type: string, value: unknown) {
  if (!CHAT_DEVELOPMENT_ARTIFACT_TYPE_SET.has(type) || !value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Unsupported Development chat artifact')
  }
  const source = value as Json
  const notes = text(source.notes)
  const checklist = Array.isArray(source.checklist)
    ? source.checklist.map(item => text(item, 1000)).filter(Boolean).slice(0, 100)
    : []
  if (!notes && !checklist.length) throw new Error('Development chat artifact requires notes or checklist items')
  return { notes, checklist }
}

export function developmentChatArtifactResponseFormat(type: string) {
  if (!CHAT_DEVELOPMENT_ARTIFACT_TYPE_SET.has(type)) throw new Error('Unsupported Development chat artifact')
  return {
    type: 'json_schema',
    name: `anka_${type}_draft`,
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['notes', 'checklist'],
      properties: {
        notes: { type: 'string' },
        checklist: { type: 'array', items: { type: 'string' } },
      },
    },
  }
}
