import { useState, useRef, useEffect } from 'react';
import { supabase } from '../lib/supabase.js';
import { useAuth } from '../context/AuthContext.jsx';

// Simulated file system
const FS = {
  '/': { type: 'dir', children: ['home', 'etc', 'var', 'tmp'] },
  '/home': { type: 'dir', children: ['anka'] },
  '/home/anka': { type: 'dir', children: ['projects', 'notes', 'README.md'] },
  '/home/anka/README.md': { type: 'file', content: 'Welcome to Anka OS!\nA collaborative workspace for design, development, and marketing teams.' },
  '/home/anka/projects': { type: 'dir', children: [] },
  '/home/anka/notes': { type: 'dir', children: [] },
  '/etc': { type: 'dir', children: ['anka.conf'] },
  '/etc/anka.conf': { type: 'file', content: '# Anka OS Configuration\nversion=0.2.0\ntheme=dark\nai_enabled=true' },
  '/var': { type: 'dir', children: ['log'] },
  '/var/log': { type: 'dir', children: ['anka.log'] },
  '/var/log/anka.log': { type: 'file', content: '[INFO] System initialized\n[INFO] All services running' },
  '/tmp': { type: 'dir', children: [] },
};

function resolvePath(cwd, target) {
  if (!target || target === '~') return '/home/anka';
  if (target === '/') return '/';
  if (target.startsWith('~/')) target = '/home/anka/' + target.slice(2);
  if (target === '..') {
    const parts = cwd.split('/').filter(Boolean);
    parts.pop();
    return '/' + parts.join('/') || '/';
  }
  if (target === '.') return cwd;
  if (!target.startsWith('/')) {
    target = cwd === '/' ? '/' + target : cwd + '/' + target;
  }
  // normalize
  const parts = target.split('/').filter(Boolean);
  const resolved = [];
  for (const p of parts) {
    if (p === '..') resolved.pop();
    else if (p !== '.') resolved.push(p);
  }
  return '/' + resolved.join('/') || '/';
}

export default function TerminalApp() {
  const { user, profile } = useAuth();
  const [history, setHistory] = useState([
    { type: 'system', text: 'Anka OS Terminal v0.2.0' },
    { type: 'system', text: `Logged in as ${profile?.full_name || 'user'} (${profile?.department || 'unknown'})` },
    { type: 'system', text: 'Type "help" for available commands.\n' },
  ]);
  const [input, setInput] = useState('');
  const [cwd, setCwd] = useState('/home/anka');
  const [cmdHistory, setCmdHistory] = useState([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  // Load command history from DB
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('terminal_history')
        .select('command').eq('user_id', user.id)
        .order('created_at', { ascending: false }).limit(50);
      if (data) setCmdHistory(data.map((d) => d.command).reverse());
    })();
  }, [user.id]);

  function addOutput(entries) {
    setHistory((prev) => [...prev, ...entries]);
  }

  async function saveToHistory(command, output) {
    await supabase.from('terminal_history').insert([{
      user_id: user.id, command, output: output.slice(0, 2000), exit_code: 0,
    }]);
  }

  async function handleCommand(e) {
    e.preventDefault();
    const raw = input.trim();
    if (!raw) return;

    setInput('');
    setCmdHistory((prev) => [...prev, raw]);
    setHistoryIdx(-1);

    const entries = [{ type: 'input', text: `${shortPath(cwd)} $ ${raw}` }];
    const [cmd, ...args] = raw.split(/\s+/);
    const arg = args.join(' ');
    let outputText = '';

    switch (cmd.toLowerCase()) {
      case 'help':
        outputText = `Available commands:
  help          Show this help
  clear         Clear terminal
  date          Current date/time
  whoami        Show current user
  echo <msg>    Print a message
  pwd           Print working directory
  cd <dir>      Change directory
  ls [dir]      List directory
  cat <file>    Show file contents
  mkdir <dir>   Create directory
  touch <file>  Create empty file
  env           Show env variables
  uptime        System uptime
  uname         System info
  history       Command history
  tasks         Quick task summary
  projects      Quick project summary
  stats         Workspace statistics
  neofetch      System info display
  version       Anka OS version`;
        entries.push({ type: 'output', text: outputText });
        break;

      case 'clear':
        setHistory([]);
        saveToHistory(raw, '');
        return;

      case 'date':
        outputText = new Date().toString();
        entries.push({ type: 'output', text: outputText });
        break;

      case 'whoami':
        outputText = `${profile?.full_name || 'anka-user'} (${profile?.role || 'user'}) @ ${profile?.department || 'unknown'}`;
        entries.push({ type: 'output', text: outputText });
        break;

      case 'pwd':
        outputText = cwd;
        entries.push({ type: 'output', text: outputText });
        break;

      case 'cd': {
        const target = resolvePath(cwd, arg || '~');
        const node = FS[target];
        if (node && node.type === 'dir') {
          setCwd(target);
          outputText = '';
        } else {
          outputText = `cd: no such directory: ${arg}`;
          entries.push({ type: 'error', text: outputText });
        }
        break;
      }

      case 'ls': {
        const target = arg ? resolvePath(cwd, arg) : cwd;
        const node = FS[target];
        if (node && node.type === 'dir') {
          if (node.children.length === 0) {
            outputText = '(empty)';
          } else {
            outputText = node.children.map((c) => {
              const full = target === '/' ? '/' + c : target + '/' + c;
              const child = FS[full];
              return child?.type === 'dir' ? `\x1b[34m${c}/\x1b[0m` : c;
            }).join('  ');
            // For terminal display we'll use color classes instead
            outputText = node.children.map((c) => {
              const full = target === '/' ? '/' + c : target + '/' + c;
              const child = FS[full];
              return child?.type === 'dir' ? `📁 ${c}/` : `📄 ${c}`;
            }).join('\n');
          }
          entries.push({ type: 'output', text: outputText });
        } else {
          outputText = `ls: no such directory: ${arg || cwd}`;
          entries.push({ type: 'error', text: outputText });
        }
        break;
      }

      case 'cat': {
        if (!arg) { entries.push({ type: 'error', text: 'cat: missing file argument' }); break; }
        const target = resolvePath(cwd, arg);
        const node = FS[target];
        if (node?.type === 'file') {
          outputText = node.content;
          entries.push({ type: 'output', text: outputText });
        } else if (node?.type === 'dir') {
          outputText = `cat: ${arg}: Is a directory`;
          entries.push({ type: 'error', text: outputText });
        } else {
          outputText = `cat: ${arg}: No such file`;
          entries.push({ type: 'error', text: outputText });
        }
        break;
      }

      case 'mkdir': {
        if (!arg) { entries.push({ type: 'error', text: 'mkdir: missing operand' }); break; }
        const target = resolvePath(cwd, arg);
        if (FS[target]) { entries.push({ type: 'error', text: `mkdir: ${arg}: already exists` }); break; }
        const parent = target.split('/').slice(0, -1).join('/') || '/';
        const name = target.split('/').pop();
        if (FS[parent]?.type === 'dir') {
          FS[target] = { type: 'dir', children: [] };
          FS[parent].children.push(name);
          outputText = '';
        } else {
          entries.push({ type: 'error', text: `mkdir: cannot create directory: parent not found` });
        }
        break;
      }

      case 'touch': {
        if (!arg) { entries.push({ type: 'error', text: 'touch: missing operand' }); break; }
        const target = resolvePath(cwd, arg);
        if (!FS[target]) {
          const parent = target.split('/').slice(0, -1).join('/') || '/';
          const name = target.split('/').pop();
          if (FS[parent]?.type === 'dir') {
            FS[target] = { type: 'file', content: '' };
            FS[parent].children.push(name);
          }
        }
        outputText = '';
        break;
      }

      case 'env':
        outputText = `USER=${profile?.full_name || 'anka'}\nROLE=${profile?.role || 'user'}\nDEPT=${profile?.department || 'unknown'}\nSHELL=/bin/anka-sh\nHOME=/home/anka\nPATH=/usr/local/bin:/usr/bin\nTERM=anka-256color\nLANG=en_US.UTF-8`;
        entries.push({ type: 'output', text: outputText });
        break;

      case 'uptime':
        outputText = `up ${Math.floor(Math.random() * 30 + 1)} days, ${Math.floor(Math.random() * 24)}:${String(Math.floor(Math.random() * 60)).padStart(2, '0')}, 1 user`;
        entries.push({ type: 'output', text: outputText });
        break;

      case 'uname':
        outputText = arg === '-a' ? 'AnkaOS 0.2.0 x86_64 React/Vite Supabase' : 'AnkaOS';
        entries.push({ type: 'output', text: outputText });
        break;

      case 'version':
        outputText = 'Anka OS v0.2.0 (Phase 6)';
        entries.push({ type: 'output', text: outputText });
        break;

      case 'history':
        outputText = cmdHistory.slice(-20).map((c, i) => `  ${i + 1}  ${c}`).join('\n') || '(empty)';
        entries.push({ type: 'output', text: outputText });
        break;

      case 'neofetch': {
        outputText = `
   ╔═══════════════╗     ${profile?.full_name || 'User'}@anka-os
   ║   ANKA  OS    ║     ─────────────────
   ║  ┌─────────┐  ║     OS: Anka OS v0.2.0
   ║  │ ◉     ◉ │  ║     Shell: anka-sh
   ║  │    ▽    │  ║     Role: ${profile?.role || 'user'}
   ║  │  ╰───╯  │  ║     Dept: ${profile?.department || 'unknown'}
   ║  └─────────┘  ║     Theme: Dark
   ╚═══════════════╝     Terminal: Anka Terminal`;
        entries.push({ type: 'output', text: outputText });
        break;
      }

      case 'tasks': {
        const { data } = await supabase.from('tasks').select('title, status')
          .eq('user_id', user.id).order('created_at', { ascending: false }).limit(10);
        if (data?.length) {
          outputText = data.map((t) => `  [${t.status === 'done' ? '✓' : t.status === 'in_progress' ? '~' : ' '}] ${t.title}`).join('\n');
        } else {
          outputText = 'No tasks found.';
        }
        entries.push({ type: 'output', text: outputText });
        break;
      }

      case 'projects': {
        const { data } = await supabase.from('projects').select('name, status')
          .order('created_at', { ascending: false }).limit(10);
        if (data?.length) {
          outputText = data.map((p) => `  [${p.status}] ${p.name}`).join('\n');
        } else {
          outputText = 'No projects found.';
        }
        entries.push({ type: 'output', text: outputText });
        break;
      }

      case 'stats': {
        const [t, p, n] = await Promise.all([
          supabase.from('tasks').select('id', { count: 'exact', head: true }),
          supabase.from('projects').select('id', { count: 'exact', head: true }),
          supabase.from('notes').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
        ]);
        outputText = `Workspace Statistics:\n  Tasks:    ${t.count || 0}\n  Projects: ${p.count || 0}\n  Notes:    ${n.count || 0}`;
        entries.push({ type: 'output', text: outputText });
        break;
      }

      default:
        if (cmd.toLowerCase() === 'echo') {
          outputText = arg;
          entries.push({ type: 'output', text: outputText });
        } else {
          outputText = `command not found: ${cmd}`;
          entries.push({ type: 'error', text: outputText });
        }
    }

    addOutput(entries);
    saveToHistory(raw, outputText);
  }

  function handleKeyDown(e) {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (cmdHistory.length === 0) return;
      const newIdx = historyIdx < 0 ? cmdHistory.length - 1 : Math.max(0, historyIdx - 1);
      setHistoryIdx(newIdx);
      setInput(cmdHistory[newIdx] || '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIdx < 0) return;
      const newIdx = historyIdx + 1;
      if (newIdx >= cmdHistory.length) {
        setHistoryIdx(-1);
        setInput('');
      } else {
        setHistoryIdx(newIdx);
        setInput(cmdHistory[newIdx] || '');
      }
    }
  }

  function shortPath(p) {
    return p.replace('/home/anka', '~') || '/';
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
        <span className="text-green-400">{shortPath(cwd)} $</span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          className="flex-1 bg-transparent outline-none text-gray-200 caret-green-400"
          autoFocus
        />
      </form>
    </div>
  );
}
