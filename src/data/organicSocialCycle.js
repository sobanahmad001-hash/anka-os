// Commitment follows the original brief. Delivery follows the recorded publication day.
export function organicSocialCycle({ projectId, month, cards, goals }) {
  if (!projectId || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new Error('Choose a project and calendar month')
  }
  const board = []
  const calendar = new Map()
  const counts = Object.fromEntries(['post', 'reel'].map(kind => [
    kind, { goal: goals?.[kind] ?? null, committed: 0, planned: 0, scheduled: 0, delivered: 0 },
  ]))
  const seen = new Set()
  for (const card of cards) {
    if (card.project_id !== projectId || !card.work_item_id || seen.has(card.work_item_id)) {
      throw new Error('Organic Social returned an inconsistent Work record')
    }
    seen.add(card.work_item_id)
    const count = counts[card.kind]
    if (!count) throw new Error('Unknown Organic Social card type')
    const committed = card.original_month?.slice(0, 7) === month
    const planned = card.planned_date?.slice(0, 7) === month
    const scheduled = card.scheduled_date?.slice(0, 7) === month
    const delivered = card.published_date?.slice(0, 7) === month
    if (committed) count.committed++
    if (planned) count.planned++
    if (scheduled) count.scheduled++
    if (delivered) count.delivered++
    if (committed || planned || scheduled || delivered) board.push(card)
    // Use one entry per card per month, retaining earlier commitments on the board.
    const day = [card.published_date, card.scheduled_date, card.planned_date]
      .find(value => value?.slice(0, 7) === month)
    if (day) {
      if (!calendar.has(day)) calendar.set(day, [])
      calendar.get(day).push(card)
    }
  }
  return { board, calendar, counts }
}
