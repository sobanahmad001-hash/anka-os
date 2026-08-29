export function customFieldValueFromInput(fieldType, value) {
  if (fieldType === 'number') {
    if (value === '' || value === null || value === undefined) return null
    const number = Number(value)
    if (!Number.isFinite(number)) throw new Error('Enter a valid number')
    return number
  }
  if (fieldType === 'date' || fieldType === 'single_select') return value || null
  if (fieldType === 'checkbox') return value === true
  if (fieldType === 'multi_select') return Array.isArray(value) ? value : []
  return String(value ?? '')
}

export function customFieldDraftValue(definition, storedValue) {
  if (storedValue === undefined) {
    if (definition.field_type === 'checkbox') return false
    if (definition.field_type === 'multi_select') return []
    return ''
  }
  if (definition.field_type === 'number') return String(storedValue)
  return storedValue
}
