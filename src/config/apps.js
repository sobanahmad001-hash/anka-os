import NotesApp from '../apps/NotesApp.jsx';
import TasksApp from '../apps/TasksApp.jsx';
import ChatApp from '../apps/ChatApp.jsx';
import FileManagerApp from '../apps/FileManagerApp.jsx';
import SettingsApp from '../apps/SettingsApp.jsx';
import BrowserApp from '../apps/BrowserApp.jsx';
import TerminalApp from '../apps/TerminalApp.jsx';
import CalendarApp from '../apps/CalendarApp.jsx';
import ProjectsApp from '../apps/ProjectsApp.jsx';
import AdminApp from '../apps/AdminApp.jsx';
import ClientsApp from '../apps/ClientsApp.jsx';
import AssetsApp from '../apps/AssetsApp.jsx';
import DashboardApp from '../apps/DashboardApp.jsx';
import AiAssistantApp from '../apps/AiAssistantApp.jsx';
import CampaignsApp from '../apps/CampaignsApp.jsx';
import ContentHubApp from '../apps/ContentHubApp.jsx';
import AnalyticsApp from '../apps/AnalyticsApp.jsx';
import MoodboardApp from '../apps/MoodboardApp.jsx';
import DesignReviewsApp from '../apps/DesignReviewsApp.jsx';
import ApiDocsApp from '../apps/ApiDocsApp.jsx';

// ─── Shared apps available to all departments ─────────────────────────────────
const sharedApps = [
  { id: 'dashboard', name: 'Dashboard', icon: '🏠', component: DashboardApp, defaultWidth: 900, defaultHeight: 650 },
  { id: 'ai', name: 'Anka AI', icon: '🤖', component: AiAssistantApp, defaultWidth: 900, defaultHeight: 650 },
  { id: 'projects', name: 'Projects', icon: '📋', component: ProjectsApp, defaultWidth: 900, defaultHeight: 600 },
  { id: 'chat', name: 'Team Chat', icon: '💬', component: ChatApp },
  { id: 'tasks', name: 'Tasks', icon: '✅', component: TasksApp },
  { id: 'notes', name: 'Notes', icon: '📝', component: NotesApp },
  { id: 'files', name: 'Files', icon: '📁', component: FileManagerApp },
  { id: 'calendar', name: 'Calendar', icon: '📅', component: CalendarApp },
  { id: 'settings', name: 'Settings', icon: '⚙️', component: SettingsApp },
];

// ─── Admin-only apps ──────────────────────────────────────────────────────────
const adminApps = [
  { id: 'admin', name: 'Admin Panel', icon: '🛡️', component: AdminApp, defaultWidth: 950, defaultHeight: 650 },
];

// ─── Department-specific apps ─────────────────────────────────────────────────
const departmentApps = {
  design: [
    { id: 'assets', name: 'Asset Library', icon: '🖼️', component: AssetsApp, defaultWidth: 900, defaultHeight: 600 },
    { id: 'moodboard', name: 'Moodboard', icon: '🎨', component: MoodboardApp, defaultWidth: 900, defaultHeight: 650 },
    { id: 'feedback', name: 'Design Reviews', icon: '💡', component: DesignReviewsApp, defaultWidth: 900, defaultHeight: 650 },
  ],
  development: [
    { id: 'terminal', name: 'Terminal', icon: '🖥️', component: TerminalApp, defaultWidth: 850, defaultHeight: 500 },
    { id: 'browser', name: 'Browser', icon: '🌐', component: BrowserApp },
    { id: 'docs', name: 'API Docs', icon: '📚', component: ApiDocsApp, defaultWidth: 900, defaultHeight: 600 },
  ],
  marketing: [
    { id: 'clients', name: 'Clients', icon: '🤝', component: ClientsApp, defaultWidth: 900, defaultHeight: 600 },
    { id: 'campaigns', name: 'Campaigns', icon: '📊', component: CampaignsApp, defaultWidth: 900, defaultHeight: 600 },
    { id: 'content', name: 'Content Hub', icon: '✏️', component: ContentHubApp, defaultWidth: 950, defaultHeight: 650 },
    { id: 'analytics', name: 'Analytics', icon: '📈', component: AnalyticsApp, defaultWidth: 900, defaultHeight: 650 },
  ],
};

export function getDepartmentApps(department, role) {
  const deptSpecific = departmentApps[department] || [];
  const admin = role === 'admin' ? adminApps : [];
  // admins also get clients + assets regardless of department
  const extraApps = role === 'admin' ? [
    ...(department !== 'marketing' ? [{ id: 'clients', name: 'Clients', icon: '🤝', component: ClientsApp, defaultWidth: 900, defaultHeight: 600 }] : []),
    ...(department !== 'design' ? [{ id: 'assets', name: 'Asset Library', icon: '🖼️', component: AssetsApp, defaultWidth: 900, defaultHeight: 600 }] : []),
  ] : [];
  return [...admin, ...deptSpecific, ...extraApps, ...sharedApps];
}

export function getAllApps() {
  return sharedApps;
}
