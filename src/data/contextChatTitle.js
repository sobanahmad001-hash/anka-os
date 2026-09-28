export function contextChatTitleFromMessage(message) {
  const normalized = String(message || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return 'New conversation'
  const characters = Array.from(normalized)
  if (characters.length <= 80) return normalized
  return `${characters.slice(0, 79).join('').trimEnd()}…`
}