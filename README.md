# Anka OS

A **browser-based operating system** and collaborative workspace for teams. Anka OS looks and feels like a real desktop — with draggable, resizable windows, a taskbar, an app launcher, and a suite of productivity apps — all running in the browser, backed by [Supabase](https://supabase.com) and powered by an AI assistant.

---

## What is Anka OS?

Anka OS is a web application that simulates a full desktop environment inside the browser. It is designed for companies and teams organised into **departments** (Design, Development, Marketing), with each department getting access to tools tailored to their workflow. Every user has a **role** (admin, department_head, executive, intern) that further controls what they can see and do.

Think of it as an all-in-one internal platform where your team can manage projects, chat, track time, review designs, run campaigns, and chat with an AI assistant — without ever leaving the browser tab.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, TailwindCSS v4, React Router DOM v7 |
| Backend / DB | Supabase (PostgreSQL, Auth, Realtime, Storage) |
| AI | Anthropic Claude (`claude-haiku-4`) → OpenAI (`gpt-4o-mini`) fallback |
| Deployment | Vercel |

---

## Project Structure

```
anka-os/
├── index.html                  # App entry point
├── vite.config.js              # Vite + TailwindCSS config
├── vercel.json                 # Vercel deployment config
│
├── supabase/                   # Database migration files
│   ├── schema.sql              # Base schema (profiles, notes, tasks, messages)
│   ├── phase2.sql              # Departments, projects, clients, assets
│   ├── phase3.sql              # Notifications, activity log
│   ├── phase4.sql              # AI conversations, decisions, behavior logs
│   ├── phase5.sql              # Campaigns, content, design reviews, API docs
│   ├── phase6.sql              # Time logs, reports, bookmarks, terminal history
│   ├── phase7.sql              # Wiki, invoices, comments, user presence
│   ├── phase8.sql              # User preferences, audit logs, templates
│   ├── phase9.sql              # Subtasks, contacts, tags, pinned apps
│   ├── phase10.sql             # Calendar events, task labels, announcements
│   ├── phase11.sql             # Pomodoro sessions, snippets, chat reactions
│   ├── phase12.sql             # Hierarchy-based permissions, project progress
│   └── storage.sql             # Supabase Storage bucket policies
│
└── src/
    ├── main.jsx                # React root (AuthProvider, ThemeProvider, Router)
    ├── index.css               # Global styles
    │
    ├── config/
    │   └── apps.js             # App registry — maps IDs to components, controls
    │                           #   which apps are visible per role/department
    │
    ├── context/
    │   └── AuthContext.jsx     # Supabase auth state (user, profile, sign in/up/out)
    │
    ├── hooks/
    │   ├── usePresence.js      # Real-time user presence (online/away/busy/offline)
    │   ├── useNotifications.js # In-app notification subscriptions
    │   ├── useBehaviorLog.js   # Logs user actions for audit/AI context
    │   └── useTheme.jsx        # Dark/light theme management
    │
    ├── lib/
    │   ├── supabase.js         # Supabase client singleton
    │   ├── ai-provider.js      # AI API calls (Claude → OpenAI cascade)
    │   ├── ai-context.js       # Builds workspace context sent to the AI
    │   └── ai-actions.js       # Parses & executes AI-suggested actions
    │
    ├── components/
    │   ├── WindowManager.jsx   # Renders all open (non-minimized) windows
    │   ├── Window.jsx          # Draggable, resizable window frame
    │   ├── Taskbar.jsx         # Bottom bar: pinned apps, open windows, clock
    │   ├── AppLauncher.jsx     # Start-menu-style app grid
    │   ├── GlobalSearch.jsx    # Cross-app search
    │   └── CommentsPanel.jsx   # Contextual comments sidebar
    │
    └── apps/                   # One file per app (see "Apps" section below)
```

---

## Apps

### Shared — available to every user

| App | Icon | Description |
|---|---|---|
| Dashboard | 🏠 | Workspace overview — recent activity, quick stats |
| Anka AI | 🤖 | AI assistant that can chat and take real actions in the workspace |
| Projects | 📋 | Create and manage projects across departments |
| Team Chat | 💬 | Real-time team messaging with reactions |
| Tasks | ✅ | Personal and shared task lists (todo / in progress / done) |
| Notes | 📝 | Rich personal notes organised into folders |
| Files | 📁 | File manager backed by Supabase Storage |
| Calendar | 📅 | Events, meetings, and deadlines |
| Time Tracker | ⏱️ | Log time against tasks and projects |
| Reports | 📊 | Productivity and team reports |
| Wiki | 📖 | Internal team knowledge base |
| Templates | 📋 | Reusable content and document templates |
| Contacts | 📇 | Contact directory |
| Notifications | 🔔 | In-app notification centre |
| Kanban Board | 📌 | Visual drag-and-drop task board |
| Activity | 📜 | Full audit / activity log |
| Team | 👥 | Team member list with real-time presence indicators |
| Pomodoro | 🍅 | Focus timer with session tracking |
| Snippets | ✂️ | Code and text snippet library |
| Settings | ⚙️ | User preferences, theme, notification settings |

### Admin only

| App | Icon | Description |
|---|---|---|
| Admin Panel | 🛡️ | Manage users, roles, and departments |

### Design department

| App | Icon | Description |
|---|---|---|
| Asset Library | 🖼️ | Upload and browse design assets |
| Moodboard | 🎨 | Visual inspiration boards |
| Design Reviews | 💡 | Feedback threads on design deliverables |

### Development department

| App | Icon | Description |
|---|---|---|
| Terminal | 🖥️ | In-browser terminal with command history |
| Browser | 🌐 | In-app web browser |
| API Docs | 📚 | API documentation viewer |

### Marketing department

| App | Icon | Description |
|---|---|---|
| Clients | 🤝 | CRM — client and lead management |
| Campaigns | 📊 | Marketing campaign tracker (status, budget, dates) |
| Content Hub | ✏️ | Content planning and publishing pipeline |
| Analytics | 📈 | Marketing analytics dashboard |
| Invoices | 🧾 | Invoice creation and management |

---

## Key Features

- **Desktop UI** — every app opens in its own draggable, resizable, minimizable window with a taskbar at the bottom.
- **Role-based access control** — `admin` sees everything; `department_head`, `executive`, and `intern` see shared apps plus their own department's apps.
- **Real-time collaboration** — Supabase Realtime keeps chat, tasks, and presence in sync across all connected users.
- **User presence** — see who on your team is online, away, or busy at a glance.
- **Anka AI** — the built-in AI assistant has full workspace context and can create tasks, update projects, log decisions, send notifications, and add clients — all with your approval before anything is written to the database.
- **Global search** — search across apps from a single input.
- **Themes** — dark and light mode, persisted in user preferences.
- **Audit trail** — every significant action is logged for accountability.
- **Row-level security** — all database tables enforce Supabase RLS policies so users can only access data they are authorised to see.

---

## Getting Started

### Prerequisites

- Node.js ≥ 18
- A [Supabase](https://supabase.com) project

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Create a `.env.local` file in the project root:

```env
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>

# AI (choose one or both — Claude is tried first)
VITE_AI_ENDPOINT=/api/ai/chat        # recommended: server-side endpoint
# or direct browser keys (dev only):
VITE_CLAUDE_API_KEY=sk-ant-...
VITE_OPENAI_API_KEY=sk-...
```

### 3. Set up the database

Run the SQL files in order in your Supabase SQL Editor:

```
schema.sql → phase2.sql → phase3.sql → … → phase12.sql → storage.sql
```

### 4. Start the dev server

```bash
npm run dev
```

### Other commands

```bash
npm run build    # production build
npm run preview  # preview the production build locally
npm run lint     # run ESLint
```