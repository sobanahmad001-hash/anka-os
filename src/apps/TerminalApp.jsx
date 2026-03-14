import { useState, useRef, useEffect } from 'react';

export default function TerminalApp() {
  const [history, setHistory] = useState([
    { type: 'system', text: 'Anka OS Terminal v0.1.0' },
    { type: 'system', text: 'Type "help" for available commands.\n' },
  ]);
  const [input, setInput] = useState('');
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  function handleCommand(e) {
    e.preventDefault();
    const cmd = input.trim();
    if (!cmd) return;

    const newEntries = [{ type: 'input', text: `$ ${cmd}` }];

    switch (cmd.toLowerCase()) {
      case 'help':
        newEntries.push({
          type: 'output',
          text: 'Available commands:\n  help      — Show this help\n  clear     — Clear terminal\n  date      — Current date/time\n  whoami    — Show current user info\n  echo <msg> — Print a message\n  version   — Anka OS version',
        });
        break;
      case 'clear':
        setHistory([]);
        setInput('');
        return;
      case 'date':
        newEntries.push({ type: 'output', text: new Date().toString() });
        break;
      case 'whoami':
        newEntries.push({ type: 'output', text: 'anka-user@anka-os' });
        break;
      case 'version':
        newEntries.push({ type: 'output', text: 'Anka OS v0.1.0-mvp' });
        break;
      default:
        if (cmd.toLowerCase().startsWith('echo ')) {
          newEntries.push({ type: 'output', text: cmd.slice(5) });
        } else {
          newEntries.push({
            type: 'error',
            text: `command not found: ${cmd}`,
          });
        }
    }

    setHistory((prev) => [...prev, ...newEntries]);
    setInput('');
  }

  return (
    <div
      className="h-full bg-[#0d1117] p-4 font-mono text-sm flex flex-col overflow-hidden"
      onClick={() => inputRef.current?.focus()}
    >
      <div className="flex-1 overflow-y-auto">
        {history.map((entry, i) => (
          <div
            key={i}
            className={`whitespace-pre-wrap leading-relaxed ${
              entry.type === 'input'
                ? 'text-green-400'
                : entry.type === 'error'
                  ? 'text-red-400'
                  : entry.type === 'system'
                    ? 'text-[var(--anka-accent)]'
                    : 'text-gray-300'
            }`}
          >
            {entry.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleCommand} className="flex items-center gap-2 pt-2">
        <span className="text-green-400">$</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="flex-1 bg-transparent outline-none text-gray-200 caret-green-400"
          autoFocus
        />
      </form>
    </div>
  );
}
