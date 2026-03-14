# Development Department — Current State & Analysis

## 📊 Current Structure

### Hierarchy
```
Dev Head (department_head, role='department_head')
├── Tech Lead / Executive Dev (executive)
│   ├── Developer A
│   ├── Developer B
│   └── ...
└── Interns (intern)
```

---

## 🛠️ Department-Specific Apps (3 implemented)

### 1. **TERMINAL** 🖥️ (`TerminalApp.jsx`)
**Status:** ✅ MVP Implemented | ⚠️ Simulated (not real shell)

**Current Features:**
- Simulated Unix-like CLI with ~20 commands
- Virtual file system (in-memory, no persistence)
- Command history + arrow key navigation
- Integration with Anka OS data:
  - `tasks` — View user's tasks from CLI
  - `projects` — View all projects
  - `stats` — Workspace statistics
  - `whoami`, `env`, `neofetch` — Profile info

**Supported Commands:**
```
help, clear, date, whoami, echo, pwd, cd, ls, cat
mkdir, touch, env, uptime, uname, history, version
tasks, projects, stats, neofetch
```

**Database Integration:**
- Reads from: `terminal_history`, `tasks`, `projects`
- Saves command history to `terminal_history` table

**Limitations:**
- ❌ No real shell execution (all simulated)
- ❌ Virtual file system doesn't persist
- ❌ Can't execute real scripts/binaries
- ❌ No git integration
- ❌ No CI/CD integration

**What Could Be Enhanced:**
- Real shell integration (via backend API)
- Command execution logging & audit trail
- Script templates & automation
- Environment variable management
- Git command shortcuts

---

### 2. **BROWSER** 🌐 (`BrowserApp.jsx`)
**Status:** ✅ Basic Browser | ⚠️ iframe-based

**Current Features:**
- Simple URL bar navigation
- Bookmark management (organized by folders)
- Add/remove bookmarks from current page
- Sandbox iframe with security restrictions

**Database Integration:**
- Reads/writes: `bookmarks` table
- User-scoped bookmarks (`user_id`)

**Limitations:**
- ❌ iframe limitations (some websites may not work)
- ❌ No dev tools / inspector
- ❌ No ability to test mobile responsiveness
- ❌ No cookie/cache management UI
- ❌ No download manager
- ❌ No tab management

**What Could Be Enhanced:**
- Multiple tabs
- Browser history & search
- Developer tools panel (inspect elements)
- Mobile responsiveness tester
- Screenshot / page capture
- Link preview on hover

---

### 3. **API DOCS** 📚 (`ApiDocsApp.jsx`)
**Status:** ✅ Full CRUD | ✅ Functional

**Current Features:**
- Create/Read/Update/Delete API documentation
- Filter by category & search by endpoint
- Link docs to projects
- Color-coded HTTP methods (GET/POST/PUT/PATCH/DELETE/WS)
- Markdown content support
- Group docs by category

**Database Integration:**
- Table: `api_docs` (id, title, content, method, endpoint, category, project_id, created_by, updated_at)
- Links to: `projects`, `profiles` (created_by)

**Supported Methods:**
- GET (green), POST (blue), PUT (yellow), PATCH (orange), DELETE (red), WS (purple)

**What Could Be Enhanced:**
- Request/response examples (JSON)
- Parameter documentation (query, body, path)
- Authentication requirements
- Error codes & status codes
- Rate limiting info
- API versioning
- Code generation (curl, fetch, axios, etc.)
- Live API testing / playground
- Import from Swagger/OpenAPI

---

## 📦 Database Tables (Development Related)

### Direct Development Tables
```
terminal_history (id, user_id, command, output, exit_code, created_at)
```

### Shared/Referenced Tables
```
api_docs (id, title, content, method, endpoint, category, project_id, created_by, updated_at)
snippets (id, title, content, language, user_id, is_public, created_at)
time_logs (id, user_id, task_id, duration_minutes, date, description)
projects (id, name, department_id, status, progress, owner_id, ...)
tasks (id, user_id, assigned_to, project_id, department, status, ...)
```

---

## 🚨 Current Gap Analysis

### Missing / Incomplete Features

| Feature | Importance | Status |
|---------|-----------|--------|
| **Git Integration** | 🔴 HIGH | ❌ Not implemented |
| **GitHub/GitLab Connect** | 🔴 HIGH | ❌ Not implemented |
| **CI/CD Pipeline Dashboard** | 🔴 HIGH | ❌ Not implemented |
| **Code Review Queue** | 🔴 HIGH | ❌ Not implemented |
| **Pull Request Tracking** | 🔴 HIGH | ❌ Not implemented |
| **Environment Management** | 🟠 MEDIUM | ❌ Not implemented |
| **Deployment Tracking** | 🟠 MEDIUM | ❌ Not implemented |
| **Real Terminal/Shell** | 🟠 MEDIUM | ⚠️ Simulated only |
| **Sprint Planning** | 🟠 MEDIUM | ⚠️ Generic Tasks app |
| **Dev Environment Setup** | 🟠 MEDIUM | ❌ Not implemented |
| **Bug/Issue Tracking** | 🟠 MEDIUM | ⚠️ Uses generic Tasks |
| **Code Metrics/Analytics** | 🟡 LOW | ❌ Not implemented |
| **API Testing Console** | 🟡 LOW | ❌ Not implemented (API Docs is write-only) |
| **Deployment Rollback** | 🟡 LOW | ❌ Not implemented |

---

## 🎯 Recommended Development Environment Enhancements (Phase 13)

### TIER 1: Core Developer Workflow (Priority)
1. **Git Integration Panel**
   - Show git status (branch, uncommitted changes)
   - Quick commit/push/pull UI
   - Repository browser
   - Commit history & diffs

2. **Pull Request Dashboard**
   - Link to GitHub/GitLab PRs
   - PR status (draft, review, approved, merged)
   - Code review checklist
   - Auto-link to related tasks

3. **Environment Variables Manager**
   - Store dev/staging/prod env vars
   - Scoped by environment
   - Secret management
   - Quick access from terminal

### TIER 2: Development Workflow (Medium Priority)
4. **CI/CD Pipeline Dashboard**
   - Pipeline status (running, passed, failed)
   - Build logs viewer
   - Deploy history
   - Rollback UI

5. **Sprint Planning Tools**
   - Sprint backlog (tasks filtered for dev dept)
   - Velocity tracking
   - Burndown chart
   - Sprint-specific subtasks

6. **Issue/Bug Tracker** (Department-scoped)
   - Priority, severity, status
   - Assignee, reporter, labels
   - Linked to tasks

### TIER 3: Nice-to-Have Features (Nice to Have)
7. **Real Terminal Access** (if backend supports)
   - SSH/local shell bridging
   - Persistent working directory
   - Environment persistence

8. **API Testing Console**
   - Test endpoints from API Docs
   - Save/replay requests
   - Response inspection

9. **Code Metrics Dashboard**
   - Test coverage
   - Build time trends
   - Performance metrics

---

## 🚀 Quick Wins (Easy to Implement)

1. **Terminal Enhancements** (1-2 hrs)
   - Add more realistic commands (`git status`, `npm run`, `docker ps`)
   - Add command aliases
   - Better error messages
   - Quick links to docs

2. **API Docs → Testing** (2-3 hrs)
   - Add "Try It Out" button
   - Dynamic request builder
   - Response pretty-printer

3. **Dev Dashboard Widget** (1-2 hrs)
   - Show today's tasks
   - Git status snapshot
   - PR count badge
   - Last deployment time

4. **Environment Shortcuts** (1-2 hrs)
   - Quick env var access from terminal
   - Copy to clipboard
   - Search/filter

---

## 📋 Proposed Database Additions (Phase 13)

### New Tables Needed
```sql
-- Git & Code Reviews
git_repos (id, user_id, owner, name, url, last_sync)
pull_requests (id, repo_id, pr_number, title, status, url, created_at)

-- Environments & Deployments
environments (id, dept_id, name, type='dev'|'staging'|'prod')
environment_variables (id, env_id, key, value, is_secret)
deployments (id, env_id, status, version, deployed_at, deployed_by)
deployment_logs (id, deployment_id, log_text)

-- CI/CD Pipelines
ci_pipelines (id, repo_id, pipeline_id, status, branch, started_at)
pipeline_jobs (id, pipeline_id, job_id, name, status, log_url)

-- Development Issues/Bugs
dev_issues (id, dept_id, title, description, severity, status, assigned_to, created_by)
issue_labels (id, issue_id, label)

-- Sprint Planning
sprints (id, dept_id, name, start_date, end_date, goal)
sprint_tasks (id, sprint_id, task_id, story_points, priority)
sprint_metrics (sprint_id, velocity, completed_points, issues_count)
```

---

## 🔗 Integration Opportunities

- **GitHub/GitLab API** → PR dashboard, commit tracking
- **Vercel/Netlify API** → Deployment tracking
- **Jenkins/GitHub Actions API** → CI/CD status
- **Slack API** → Dev notifications
- **Docker API** → Container management
- **AWS/Heroku API** → Environment provisioning

---

## Next Steps

**Which enhancement would you like to tackle first?**

1. ✅ **Git Integration** — Link to GitHub/GitLab, PR dashboard
2. ✅ **Environment Variables Manager** — Secure env var storage  
3. ✅ **API Testing Console** — Test endpoints live from docs
4. ✅ **Terminal Improvements** — Better commands, git shortcuts
5. ✅ **Dev Dashboard** — At-a-glance dev status
6. ✅ **Issue Tracker** — Dev-scoped bug tracking
7. ✅ **CI/CD Dashboard** — Build & deployment tracking
8. ✅ **Sprint Planning** — Dev team sprint board

**Or should we build all of these as a comprehensive Phase 13?**
