import assert from 'node:assert/strict'
import test from 'node:test'
import { contextChatTitleFromMessage } from './contextChatTitle.js'

test('first saved message becomes a whitespace-normalized title', () => {
  assert.equal(contextChatTitleFromMessage('  Clarify   the   launch\nsequence  '), 'Clarify the launch sequence')
})

test('long first messages produce bounded titles without splitting Unicode characters', () => {
  const title = contextChatTitleFromMessage('🙂'.repeat(100))
  assert.equal(Array.from(title).length, 80)
  assert.equal(title.endsWith('…'), true)
})

test('empty first messages use the safe default title', () => {
  assert.equal(contextChatTitleFromMessage('  '), 'New conversation')
})