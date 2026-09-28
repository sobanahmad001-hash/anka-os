import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const assistant = readFileSync(new URL('../apps/AnkaAssistant.jsx', import.meta.url), 'utf8')
const project = readFileSync(new URL('../apps/ProjectEngagementWorkspace.jsx', import.meta.url), 'utf8')
const conversation = readFileSync(new URL('../components/ContextConversationPanel.jsx', import.meta.url), 'utf8')

test('Universal Assistant opens on chat and keeps record tools explicit and separately audited', () => {
  assert.match(assistant, /useState\('conversations'\)/)
  assert.match(assistant, />Chat<\/button>[\s\S]*?>Record tools<\/button>/)
  assert.match(assistant, /The chat transcript is not copied into the request/)
  assert.match(assistant, /Run \{result\.run_id\}/)
  assert.match(assistant, /not saved as a conversation message/)
  assert.match(assistant, /aiRepository\.recordDecision\(result\.run_id, 'accepted'/)
  assert.match(assistant, /aiRepository\.recordDecision\(result\.run_id, 'rejected'/)
})

test('Project Chat keeps the shared team thread and private AI conversations in separate views', () => {
  assert.match(project, /useState\('team'\)/)
  assert.match(project, /Team discussion · shared/)
  assert.match(project, /AI conversations/)
  assert.match(project, /<section hidden=\{projectChatMode !== 'team'\} aria-label="Shared project team discussion"/)
  assert.match(project, /<section hidden=\{projectChatMode !== 'private'\} aria-label="Project AI conversations"/)
  assert.match(project, /<ProjectDiscussionPanel /)
  assert.match(project, /<ContextConversationPanel contextKind="project_team"/)
  assert.match(project, /tab === 'overview' && <section aria-label="Workspace summary"/)
  assert.match(conversation, /Share this project conversation/)
  assert.match(conversation, /creator-controlled/)
  assert.match(conversation, /renameContextConversation\(\{/)
  assert.match(conversation, /firstSavedMessage/)
})