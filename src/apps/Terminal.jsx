import { useState } from 'react'
import Card from '../components/Card'

export default function Terminal() {
  const [output, setOutput] = useState([
    'Development Terminal',
    'Execution support surface for quick command-oriented checks.',
    'Type "help" for commands.',
    '',
  ])
  const [input, setInput] = useState('')

  function handleCommand(e) {
    e.preventDefault()
    if (!input.trim()) return

    const cmd = input.trim()
    setOutput((prev) => [...prev, `$ ${cmd}`, ...executeCommand(cmd), ''])
    setInput('')
  }

  function executeCommand(cmd) {
    const parts = cmd.split(' ')
    const command = parts[0]

    switch (command) {
      case 'help':
        return [
          'Available commands:',
          '  help        - Show command list',
          '  clear       - Clear terminal output',
          '  queue       - Show development queue summary',
          '  blockers    - Show blocker signal',
          '  git status  - Mock git status output',
        ]
      case 'clear':
        setOutput([
          'Development Terminal',
          'Execution support surface for quick command-oriented checks.',
          '',
        ])
        return []
      case 'queue':
        return [
          'Queue summary:',
          '  todo: 3',
          '  in_progress: 2',
          '  blocked: 1',
          '  done: 5',
        ]
      case 'blockers':
        return [
          'Current blocker signal:',
          '  1 task is marked blocked',
          '  review escalation path in Sprint / Queue',
        ]
      case 'git':
        if (parts[1] === 'status') {
          return [
            'On branch feat/shell-environment-nav',
            'Changes not staged for commit:',
            '  modified: src/apps/DevDashboard.jsx',
            '  modified: src/apps/Kanban.jsx',
          ]
        }
        return ['git: unknown command. Try: git status']
      default:
        return [`bash: ${command}: command not found`]
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Terminal</h1>
        <p className="mt-1 text-gray-600 dark:text-gray-400">
          Lightweight command surface that supports development execution without becoming the core product.
        </p>
      </div>

      <Card
        title="Command Surface"
        subtitle="Use this for quick checks and execution support inside the Development environment."
        className="p-0"
      >
        <div className="bg-gray-950 text-green-400 font-mono p-4 rounded-b-xl h-[600px] overflow-y-auto">
          {output.map((line, i) => (
            <div key={i}>{line}</div>
          ))}

          <form onSubmit={handleCommand} className="flex items-center mt-1">
            <span className="mr-2">$</span>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="flex-1 bg-transparent outline-none"
              autoFocus
            />
          </form>
        </div>
      </Card>
    </div>
  )
}
