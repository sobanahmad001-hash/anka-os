# Anka OS — System Architecture & Department Structure

## 🏗️ Overall System Architecture

**Technology Stack:**
- Frontend: React 19 + Vite 6 + Tailwind CSS 4
- Backend: Supabase (PostgreSQL + Auth + RLS)
- Deployment: Vercel (auto-deploys on git push)
- 32 Apps + 44 Database Tables + 12 Migration Phases

---

## 📊 Database Tables (44 Total)

### Core Infrastructure
- `profiles` — User roles, departments (admin/head/executive/intern)
- `user_status` — Online/offline presence
- `user_preferences` — Theme, notification settings
- `audit_logs`, `action_audit`, `behavior_logs` — System tracking

### Shared Workspaces
- `messages` — Team chat messages
- `message_reactions` — Emoji reactions on chat
- `comments` — Comments on tasks/projects/resources
- `notifications` — User notifications
- `team_announcements` — Department/organization announcements

### Tasks & Projects (Phase 12 ★ NEW)
- `tasks` — **NOW includes**: user_id, assigned_to, assigned_by, project_id, **department**, priority, status
- `projects` — project_id, status, **progress** (0-100%), owner_id, department_id
- `project_members` — Team assignment to projects
- `subtasks` — Checklist items under tasks
- `task_labels` — Tags on tasks

### Time & Calendar
- `calendar_events` — Shared calendar
- `time_logs` — Time tracking entries
- `pomodoro_sessions` — Pomodoro timer sessions

### Notes & Wiki
- `notes` — User notes with optional folder hierarchy
- `note_folders` — Folder structure for notes
- `wiki_pages` — Shared wiki documentation
- `templates` — Reusable templates (doc, email, etc.)

### AI & Knowledge
- `ai_conversations` — Conversation threads with Anka AI
- `ai_messages` — Individual AI chat messages
- `api_docs` — API documentation database
- `decisions` — Recorded decision logs with reasoning
- `snippets` — Code snippets library

### Design Department (3 Apps)
- `assets` — Design asset library with metadata
- `moodboard_items` — Moodboard collections & items
- `design_reviews` — Design review sessions
- `review_comments` — Comments on design reviews

### Development Department (3 Apps)
- `terminal_history` — Terminal command history
- *Browser app* — No persistence table (read-only web browser)
- `api_docs` — API documentation (cross-dept; also shared)

### Marketing Department (5 Apps)
- `clients` — Client database with contacts
- `campaigns` — Marketing campaign tracking
- `content_items` — Blog posts, social media content
- `client_projects` — Projects linked to clients
- `invoices` — Invoice generation & tracking
- `invoice_items` — Line items in invoices
- `analytics` — Analytics & metrics data
- `reports` — Generated reports

### Admin & System
- `departments` — Department reference table (design/development/marketing)
- `pinned_apps` — Quick access shortcuts
- `bookmarks` — User bookmarks
- `tags` — Global tags system
- `activity_log` — Global activity stream

---

## 🏢 Department Breakdown

### 1. **DESIGN DEPARTMENT** 👨‍🎨
**Role Hierarchy:** Design Head → Executive Designer → Intern Designer

**Department-Specific Apps (3):**
| App | id | Purpose | Status |
|-----|-----|---------|--------|
| Asset Library | `assets` | Centralized design asset repository | ✅ Implemented |
| Moodboard | `moodboard` | Inspiration boards & design collections | ✅ Implemented |
| Design Reviews | `feedback` | Review & feedback on prototypes | ✅ Implemented |

**Related Database Tables:**
- `assets` — Design files, images, icons
- `moodboard_items` — Visual inspiration items
- `design_reviews` — Review sessions & feedback
- `review_comments` — Detailed feedback threads
- `tasks` (filtered by department='design') — Design tasks
- `projects` (filtered by department='design') — Design projects

**Potential Environment Customizations:**
- Design review workflows (approval chains)
- Asset versioning & approval process
- Figma/Sketch API integration
- Color palette & brand guidelines enforcement
- Design handoff checklist templates

---

### 2. **DEVELOPMENT DEPARTMENT** 👨‍💻
**Role Hierarchy:** Dev Head → Tech Lead/Executive → Developer/Intern

**Department-Specific Apps (3):**
| App | id | Purpose | Status |
|-----|-----|---------|--------|
| Terminal | `terminal` | In-browser terminal for commands | ✅ Implemented |
| Browser | `browser` | In-browser web browser | ✅ Implemented |
| API Docs | `docs` | API documentation & reference | ✅ Implemented |

**Related Database Tables:**
- `terminal_history` — Command history & logs
- `api_docs` — API specifications & documentation
- `tasks` (filtered by department='development') — Dev tasks
- `projects` (filtered by department='development') — Dev projects
- `snippets` — Code snippet library
- `ai_conversations` — Dev questions to Anka AI

**Potential Environment Customizations:**
- Git integration & commit workflow
- CI/CD pipeline dashboard
- Code review queue & pull request tracking
- Environment variable management (dev/staging/prod)
- Docker container management
- Bug/issue severity & triaging rules
- Sprint planning & velocity tracking

---

### 3. **MARKETING DEPARTMENT** 📢
**Role Hierarchy:** Marketing Head → Marketing Manager → Content Creator/Analyst

**Department-Specific Apps (5):**
| App | id | Purpose | Status |
|-----|-----|---------|--------|
| Clients | `clients` | Client CRM & relationship tracking | ✅ Implemented |
| Campaigns | `campaigns` | Campaign planning & execution | ✅ Implemented |
| Content Hub | `content` | Content calendar & publishing | ✅ Implemented |
| Analytics | `analytics` | Marketing metrics & dashboards | ✅ Implemented |
| Invoices | `invoices` | Invoice & billing management | ✅ Implemented |

**Related Database Tables:**
- `clients` — Client database
- `client_projects` — Projects linked to clients
- `campaigns` — Campaign data
- `content_items` — Blog posts, ads, social media
- `invoices`, `invoice_items` — Billing & revenue
- `analytics` — Campaign performance metrics
- `tasks` (filtered by department='marketing') — Marketing tasks
- `projects` (filtered by department='marketing') — Marketing projects

**Potential Environment Customizations:**
- Multi-channel campaign orchestration (email, social, SMS)
- Email template builder & A/B testing
- Social media publishing calendar & automation
- Lead scoring & nurturing workflows
- ROI tracking & attribution modeling
- Content approval workflows
- Client portal & feedback collection

---

## 🔗 Shared Apps (20 — All Departments)

**Core Workspace:**
- Dashboard (🏠) — Personal/team dashboard
- Anka AI (🤖) — AI assistant across org
- Projects (📋) — Cross-department project view
- Tasks (✅) — Unified task management
- Team Chat (💬) — Organization chat
- Files (📁) — File storage & sharing
- Calendar (📅) — Shared calendar

**Productivity:**
- Notes (📝) — Personal/shared note taking
- Templates (📋) — Reusable templates
- Wiki (📖) — Knowledge base
- Snippets (✂️) — Shared code/content snippets
- Contacts (📇) — Internal & external contacts

**Visibility & Tracking:**
- Time Tracker (⏱️) — Time logging
- Reports (📊) — Cross-dept reports
- Activity (📜) — Organization activity stream
- Kanban (📌) — Alternative task board view
- Pomodoro (🍅) — Focus timer

**Admin & Config:**
- Notifications (🔔) — Notification hub
- Settings (⚙️) — User preferences
- Team (👥) — Employee directory

---

## 👨‍💼 Admin Access

**Admin Panel (🛡️):**
- Can access **ALL** department apps (design + dev + marketing + admin)
- Can see all tasks/projects across all departments
- Can assign work across departments
- System administration & audit logs

---

## 📈 Phase Progression (1-12 Complete ✅)

| Phase | Feature | Status |
|-------|---------|--------|
| 1-5 | Core infrastructure, auth, chat, tasks, notes | ✅ |
| 6 | File management & storage | ✅ |
| 7 | Calendar & time tracking | ✅ |
| 8 | AI assistant integration | ✅ |
| 9 | Subtasks, contacts, tags, pinned apps | ✅ |
| 10 | Wiki, templates, snippets, bookmarks | ✅ |
| 11 | Terminal, browser, API docs, analytics | ✅ |
| 12 | **Permissions & Control (NEW)** | ✅ |
|     | - Department hierarchy | ✅ |
|     | - Task assignment & visibility | ✅ |
|     | - Project progress tracking | ✅ |
|     | - RLS by role | ✅ |
| **13+** | **Department-Specific Environments** | 🔄 Next |

---

## 🎯 Next Work: Department-Specific Customization

### Phase 13: Design Environment Overhaul
- Design-specific workflows & approval chains
- Enhanced moodboard with team collaboration
- Design asset versioning & management
- Color palette enforcement & design system
- Handoff checklist & developer notes

### Phase 14: Development Environment
- Git/GitHub integration
- CI/CD pipeline dashboard
- Code review & pull request management
- Environment variable management
- Docker & deployment tracking
- Sprint planning & burndown

### Phase 15: Marketing Environment
- Campaign orchestration & multi-channel publishing
- Email template builder
- Social media calendar & automation
- Lead scoring & nurturing
- Attribution & ROI dashboard
- Client portal

---

## 🔐 Permission Model (Phase 12)

**Admin:**
- Role: 'admin'
- Access: ALL tasks, projects, apps across all departments (no department restriction)
- Can assign work to any user

**Department Head:**
- Role: 'department_head'
- Access: All tasks/projects in their department
- Can assign work to executives & interns in their department
- Cannot see other departments' work

**Executive:**
- Role: 'executive'
- Access: Own tasks + tasks assigned by head/admin
- Cannot assign work (read-only view of team)
- Can edit assigned tasks

**Intern:**
- Role: 'intern'
- Access: Own tasks + tasks assigned by head/admin
- Cannot assign work
- Can edit assigned tasks

---

## 💾 Database Access Pattern

```
Tasks Query:
- Admin sees: ALL tasks (all departments)
- Head sees: Tasks WHERE department = their_department
- Executive/Intern sees: Tasks WHERE (user_id = me OR assigned_to = me)

Projects Query: Same as tasks (RLS enforced at database level via phase12.sql)
```

---

## 🚀 Recommendation for Next Steps

1. **Pick a department** to customize first (suggest: Development for engineering rigor)
2. **Design department-specific UI/UX** (e.g., sidebar themes, dashboard layouts)
3. **Add department models** (e.g., sprint_templates, deployment_environments)
4. **Build workflows** (e.g., approval chains, review queues, publishing pipelines)
5. **Extend apps** with department-specific features
6. Repeat for other departments

Each department environment should feel **native to that team's processes & terminology**.
