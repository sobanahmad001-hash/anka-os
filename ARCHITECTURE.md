> Historical Phase 12 architecture map (retained for context). Its 32-app hierarchy and profile-role access claims do not describe the current organization membership model. See `docs/product/RELEASE_1_AUTHORITY.md` and the active routes in `src/App.jsx` for implementation authority.

# Anka OS — Visual System Map

## 🏢 Organization Hierarchy

```
┌─────────────────────────────────────────────────────────────────┐
│                         ADMIN (🛡️)                              │
│              Can see & manage ALL departments                   │
│         + All 32 apps (shared + all dept-specific)             │
│         + All tasks/projects across all departments            │
└─────────────────────────────────────────────────────────────────┘
                              │
                ┌─────────────┼─────────────┐
                │             │             │
        ┌───────▼────────┐ ┌──▼───────────┐ ┌──▼───────────────┐
        │ DESIGN DEPT    │ │ DEVELOPMENT  │ │ MARKETING DEPT   │
        │ 👨‍🎨            │ │ 👨‍💻           │ │ 📢               │
        └────────────────┘ └──────────────┘ └──────────────────┘
                │                  │                  │
        ┌───────┴────────┐   ┌─────┴─────┐   ┌──────┴──────┐
        │                │   │           │   │             │
   ┌────▼────────┐  ┌───▼──┐ ┌───▼─────┐ ┌───▼──┐      ┌──▼──┐
   │Design Head  │  │Lead  │ │Tech     │ │Mark  │      │Mgr  │
   │ (can assign)│  │Dev   │ │Lead     │ │Head  │      │     │
   │             │  │ (assigns) │(assigns)│ (assigns)│    │     │
   └──────┬──────┘  └────┬─┘ └────┬────┘ └──┬───┘      └─┬───┘
          │               │        │         │           │
      ┌───┴────┐   ┌──────┴──┐  ┌─┴──┐   ┌──┴───┐  ┌────┴────┐
      │Exec    │   │Dev      │  │Dev │   │Exec  │  │Creator/ │
      │Designer│   │Exec     │  │    │   │Mkter │  │Analyst  │
      │ (edit  │   │(edit    │  │    │   │(edit │  │ (edit   │
      │assigned)   │assigned)   │    │   │assigned) │ assigned)
      │        │   │        │  │    │   │     │  │        │
      └────────┘   └────────┘  └────┘   └─────┘  └────────┘
           ▲             ▲       ▲          ▲            ▲
           │             │       │          │            │
           │             │       │          │            │
      Interns assigned tasks by their manager/head
      Can only see: own tasks + assigned tasks
      Cannot assign work to others
```

---

## 📱 App Distribution by Department

```
┌──────────────────────────────────────────────────────────────────┐
│                     SHARED APPS (20)                             │
│  Available to ALL users, ALL departments                         │
│                                                                  │
│  Dashboard • Anka AI • Projects • Tasks • Team Chat • Files     │
│  Calendar • Notes • Templates • Wiki • Snippets • Contacts      │
│  Time Tracker • Reports • Activity • Kanban • Pomodoro          │
│  Notifications • Settings • Team                                │
└──────────────────────────────────────────────────────────────────┘
                              △
                     ┌────────┴────────┐
                     │                 │
        ┌────────────▼────────────┐ ┌──▼───────────────────┐
        │   DESIGN DEPT APPS      │ │ DEVELOPMENT APPS     │
        │        (3)              │ │      (3)             │
        ├─────────────────────────┤ ├──────────────────────┤
        │ • Asset Library 🖼️      │ │ • Terminal 🖥️       │
        │ • Moodboard 🎨          │ │ • Browser 🌐        │
        │ • Design Reviews 💡     │ │ • API Docs 📚       │
        └─────────────────────────┘ └──────────────────────┘
                     △                        △
                     │                        │
      Design tables:                Dev tables:
      - assets                      - terminal_history
      - moodboard_items             - api_docs
      - design_reviews              - snippets
      - review_comments             - time_logs

        ┌────────────────────────────────────────────┐
        │     MARKETING DEPT APPS (5)                │
        ├────────────────────────────────────────────┤
        │ • Clients 🤝                               │
        │ • Campaigns 📊                             │
        │ • Content Hub ✏️                           │
        │ • Analytics 📈                             │
        │ • Invoices 🧾                              │
        └────────────────────────────────────────────┘
                     △
                     │
      Marketing tables:
      - clients
      - client_projects
      - campaigns
      - content_items
      - invoices
      - invoice_items
      - analytics
```

---

## 🔐 Task/Project Visibility Model (Phase 12)

```
                    ┌──────────────────┐
                    │  Task Created    │ ← user_id, assigned_to, department
                    │  & Assigned      │
                    └────────┬─────────┘
                             │
            ┌────────────────┼────────────────┐
            │                │                │
     ┌──────▼────────┐ ┌─────▼──────┐ ┌──────▼──────┐
     │    ADMIN      │ │    HEAD    │ │  EXEC/INTERN│
     │ role='admin'  │ │ role='head'│ │             │
     ├───────────────┤ ├────────────┤ ├─────────────┤
     │ Sees:         │ │ Sees:      │ │ Sees:       │
     │ • ALL tasks   │ │ • Tasks in │ │ • Own tasks │
     │ • ALL projects│ │   their    │ │   (user_id) │
     │ • ALL depts   │ │   dept     │ │ • Assigned  │
     │               │ │ • Can      │ │   tasks     │
     │ Can assign to:│ │   assign to│ │ (assigned_to)
     │ • Anyone      │ │   Exec &   │ │             │
     │               │ │   Intern   │ │ Can assign: │
     │               │ │   in dept  │ │ • CANNOT    │
     │               │ │             │ │   (read-only)
     └───────────────┘ └─────────────┘ └─────────────┘
```

---

## 📊 Database Schema Relationships

```
┌─────────────────────────────────────────────────────────────┐
│  CORE: Profiles, Auth, Permissions                          │
├─────────────────────────────────────────────────────────────┤
│  profiles (id, full_name, department, role)                │
│  user_status, user_preferences, audit_logs                │
└────────────────┬────────────────────────────────────────────┘
                 │
    ┌────────────┴────────────┬─────────────┬──────────────┐
    │                         │             │              │
┌───▼──────────────┐  ┌──────▼────────┐ ┌──▼────────┐ ┌──▼──────────┐
│ WORK MGMT        │  │ COMMUNICATION │ │ KNOWLEDGE │ │ TIME/TRACK  │
├──────────────────┤  ├───────────────┤ ├───────────┤ ├─────────────┤
│ tasks            │  │ messages      │ │ notes     │ │ calendar    │
│ project_members  │  │ msg_reactions │ │ note_folders
│ projects         │  │ comments      │ │ wiki_pages│ │ time_logs   │
│ subtasks         │  │ notifications │ │ templates │ │ pomodoro    │
│ task_labels      │  │ team_announcements
│                  │  │               │ │ snippets  │ │ user_status │
└──────────────────┘  └───────────────┘ └───────────┘ └─────────────┘
    │                         │             │              │
    ├─────────────────────────┼─────────────┼──────────────┤
    │                         │             │              │
┌───▼──────────────┐  ┌──────▼────────┐ ┌──▼────────┐ ┌──▼──────────┐
│ DESIGN DEPT      │  │ DEVELOPMENT   │ │ MARKETING │ │ AI/SYSTEM  │
├──────────────────┤  ├───────────────┤ ├───────────┤ ├─────────────┤
│ assets           │  │ terminal_hist │ │ clients   │ │ ai_convs    │
│ moodboard_items  │  │ api_docs      │ │ campaigns │ │ ai_messages │
│ design_reviews   │  │ (shared)      │ │ content   │ │ decisions   │
│ review_comments  │  │               │ │ invoices  │ │ bookmarks   │
│                  │  │               │ │ analytics │ │ tags        │
└──────────────────┘  └───────────────┘ └───────────┘ └─────────────┘
```

---

## 🎯 Current State → Next State

### Current (Phase 12 ✅)
```
STRUCTURE READY:
├── Hierarchy defined (admin/head/exec/intern)
├── Task assignment working
├── RLS permissions enforced
├── Project progress auto-calculated
└── Department filtering available
```

### Next (Phase 13+ 🔄)
```
ENVIRONMENT CUSTOMIZATION:
├── Design Environment
│   ├── Design review workflows
│   ├── Asset version control
│   ├── Team collaboration features
│   └── Brand guidelines enforcement
│
├── Development Environment
│   ├── Git/CI-CD integration
│   ├── Code review queues
│   ├── Sprint planning
│   └── Deployment tracking
│
└── Marketing Environment
    ├── Multi-channel campaigns
    ├── Email templates
    ├── Social scheduling
    └── ROI tracking
```

---

## 📋 Quick Reference: Apps by Department

### DESIGN (Designers, Creatives)
```
Dept Apps:        Shared Apps Available:
• Assets          + Dashboard, Tasks, Projects, Chat
• Moodboard       + Notes, Calendar, Wiki, Snippets
• Design Reviews  + Time Tracker, Reports, Analytics
```

### DEVELOPMENT (Engineers, Tech Leads)
```
Dept Apps:        Shared Apps Available:
• Terminal        + Dashboard, Tasks, Projects, Chat
• Browser         + Notes, Calendar, Wiki, Snippets
• API Docs        + Time Tracker, Reports, Analytics
```

### MARKETING (Marketers, Creatives)
```
Dept Apps:        Shared Apps Available:
• Clients         + Dashboard, Tasks, Projects, Chat
• Campaigns       + Notes, Calendar, Wiki, Snippets
• Content Hub     + Time Tracker, Reports, Analytics
• Analytics
• Invoices
```

### ADMIN (System Admins)
```
Access:
✅ ALL 32 apps (all shared + all dept-specific)
✅ Admin Panel for system management
✅ Full visibility across all departments
✅ Can assign work to anyone
✅ View all audit logs & system activity
```
