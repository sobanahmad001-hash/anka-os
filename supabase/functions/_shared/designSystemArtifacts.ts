type Json = Record<string, unknown>

export const CHAT_DESIGN_ARTIFACT_TYPE_SET = new Set(['design_system'])

function text(value: unknown, max = 4000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function object(value: unknown, label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Json
}

function exactKeys(value: Json, keys: string[], label: string) {
  const actual = Object.keys(value)
  if (actual.length !== keys.length || actual.some(key => !keys.includes(key))) {
    throw new Error(`${label} must contain exactly: ${keys.join(', ')}`)
  }
}

function structuredList(value: unknown, label: string, keys: string[], normalize: (row: Json) => Json) {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  if (value.length > 100) throw new Error(`${label} cannot contain more than 100 entries`)
  return value.map((entry, index) => {
    const row = object(entry, `${label} item ${index + 1}`)
    exactKeys(row, keys, `${label} item ${index + 1}`)
    return normalize(row)
  })
}

export function validateDesignSystemArtifact(type: string, value: unknown): Json {
  if (!CHAT_DESIGN_ARTIFACT_TYPE_SET.has(type)) throw new Error('Unsupported Design artifact')
  const content = object(value, 'Design system content')
  const contentKeys = ['color_tokens', 'typography_scale', 'components', 'usage_rules']
  exactKeys(content, contentKeys, 'Design system content')
  const colorTokens = structuredList(content.color_tokens, 'Color tokens', ['name', 'value'], row => {
    const name = text(row.name, 120); const tokenValue = text(row.value, 40)
    if (!name || !/^#[0-9a-f]{3,8}$/i.test(tokenValue)) throw new Error('Color tokens require a name and hexadecimal value')
    return { name, value: tokenValue }
  })
  const typographyScale = structuredList(content.typography_scale, 'Typography scale', ['name', 'font', 'size', 'weight'], row => {
    const normalized = { name: text(row.name, 120), font: text(row.font, 160), size: text(row.size, 80), weight: text(row.weight, 80) }
    if (Object.values(normalized).some(value => !value)) throw new Error('Typography entries require name, font, size, and weight')
    return normalized
  })
  const components = structuredList(content.components, 'Components', ['name', 'description', 'usage_notes'], row => {
    const normalized = { name: text(row.name, 160), description: text(row.description, 4000), usage_notes: text(row.usage_notes, 4000) }
    if (Object.values(normalized).some(value => !value)) throw new Error('Components require name, description, and usage notes')
    return normalized
  })
  return { color_tokens: colorTokens, typography_scale: typographyScale, components, usage_rules: text(content.usage_rules, 12000) }
}

export function designArtifactResponseFormat(type: string) {
  if (!CHAT_DESIGN_ARTIFACT_TYPE_SET.has(type)) throw new Error('Unsupported Design chat artifact')
  const string = () => ({ type: 'string' })
  const rows = (properties: Json) => ({
    type: 'array', minItems: 1,
    items: { type: 'object', additionalProperties: false, required: Object.keys(properties), properties },
  })
  const properties = {
    color_tokens: rows({ name: string(), value: string() }),
    typography_scale: rows({ name: string(), font: string(), size: string(), weight: string() }),
    components: rows({ name: string(), description: string(), usage_notes: string() }),
    usage_rules: string(),
  }
  return {
    type: 'json_schema', name: 'anka_design_system_draft', strict: true,
    schema: { type: 'object', additionalProperties: false, required: Object.keys(properties), properties },
  }
}
