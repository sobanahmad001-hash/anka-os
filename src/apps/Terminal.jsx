import { useState } from 'react'
import Card from '../components/Card'

export default function Terminal() {
  const [output, setOutput] = useState(['Anka OS Terminal', 'Type "help" for commands', ''])
  const [input, setInput] = useState('')
  
  function handleCommand(e) {
    e.preventDefault()
    if (!input.trim()) return
    
    const cmd = input.trim()
    setOutput(prev => [...prev, `$ ${cmd}`, ...executeCommand(cmd), ''])
    setInput('')
  }
  
  function executeCommand(cmd) {
    const parts = cmd.split(' ')
    const command = parts[0]
    
    switch (command) {
      case 'help':
        return [
          'Available commands:',
          '  help     - Show this help',
          '  clear    - Clear terminal',
          '  tasks    - List your tasks',
          '  git      - Git commands'
        ]
      case 'clear':
        setOutput(['Terminal cleared', ''])
        return []
      case 'tasks':
        return ['Fetching tasks...', '  [ ] Fix login bug', '  [x] Update docs']
      case 'git':
        if (parts[1] === 'status') {
          return ['On branch main', 'Your branch is up to date']
        }
        return ['git: unknown command. Try: git status']
      default:
        return [`bash: ${command}: command not found`]
    }
  }
  
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Terminal</h1>
      <Card className="p-0">
        <div className="bg-gray-900 text-green-400 font-mono p-4 rounded-lg h-[600px] overflow-y-auto">
          {output.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
          <form onSubmit={handleCommand} className="flex items-center">
            <span className="mr-2">$</span>
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              className="flex-1 bg-transparent outline-none"
              autoFocus
            />
          </form>
        </div>
      </Card>
    </div>
  )
}
