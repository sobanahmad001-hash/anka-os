export function captureWriterSelection(body, start, end) {
  if (typeof body !== 'string' || !Number.isInteger(start) || !Number.isInteger(end)
    || start < 0 || end <= start || end > body.length || !body.slice(start, end).trim()) {
    throw new Error('Select non-empty text in the current draft first.')
  }
  return { sourceBody: body, start, end, selectedText: body.slice(start, end) }
}

export function previewWriterReplacement(selection, replacement, currentBody) {
  if (!selection || currentBody !== selection.sourceBody) {
    throw new Error('The draft text changed. Select the text again before applying a replacement.')
  }
  if (typeof replacement !== 'string' || !replacement.trim()) {
    throw new Error('Replacement text is required.')
  }
  if (replacement === selection.selectedText) {
    throw new Error('Change the selected text before applying it.')
  }
  const after = currentBody.slice(0, selection.start) + replacement + currentBody.slice(selection.end)
  if (after.length > 120000) throw new Error('The draft text must be 120000 characters or fewer.')
  return { before: selection.selectedText, replacement, after }
}
