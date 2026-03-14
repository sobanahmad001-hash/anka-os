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
import TimeTrackerApp from '../apps/TimeTrackerApp.jsx';
import ReportsApp from '../apps/ReportsApp.jsx';
import WikiApp from '../apps/WikiApp.jsx';
import InvoicesApp from '../apps/InvoicesApp.jsx';
import TemplatesApp from '../apps/TemplatesApp.jsx';
import ContactsApp from '../apps/ContactsApp.jsx';
import NotificationsApp from '../apps/NotificationsApp.jsx';
import KanbanApp from '../apps/KanbanApp.jsx';
import ActivityApp from '../apps/ActivityApp.jsx';
import TeamApp from '../apps/TeamApp.jsx';
import PomodoroApp from '../apps/PomodoroApp.jsx';
import SnippetsApp from '../apps/SnippetsApp.jsx';
import GitIntegrationApp from '../apps/GitIntegrationApp.jsx';
import PullRequestDashboardApp from '../apps/PullRequestDashboardApp.jsx';
import CIPipelineDashboardApp from '../apps/CIPipelineDashboardApp.jsx';

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
  { id: 'timetracker', name: 'Time Tracker', icon: '⏱️', component: TimeTrackerApp, defaultWidth: 500, defaultHeight: 650 },
  { id: 'reports', name: 'Reports', icon: '📊', component: ReportsApp, defaultWidth: 900, defaultHeight: 650 },
  { id: 'wiki', name: 'Wiki', icon: '📖', component: WikiApp, defaultWidth: 900, defaultHeight: 650 },
  { id: 'templates', name: 'Templates', icon: '📋', component: TemplatesApp, defaultWidth: 800, defaultHeight: 600 },
  { id: 'contacts', name: 'Contacts', icon: '📇', component: ContactsApp, defaultWidth: 750, defaultHeight: 600 },
  { id: 'notifications', name: 'Notifications', icon: '🔔', component: NotificationsApp, defaultWidth: 600, defaultHeight: 650 },
  { id: 'kanban', name: 'Kanban Board', icon: '📌', component: KanbanApp, defaultWidth: 1000, defaultHeight: 650 },
  { id: 'activity', name: 'Activity', icon: '📜', component: ActivityApp, defaultWidth: 700, defaultHeight: 650 },
  { id: 'team', name: 'Team', icon: '👥', component: TeamApp, defaultWidth: 800, defaultHeight: 600 },
  { id: 'pomodoro', name: 'Pomodoro', icon: '🍅', component: PomodoroApp, defaultWidth: 420, defaultHeight: 650 },
  { id: 'snippets', name: 'Snippets', icon: '✂️', component: SnippetsApp, defaultWidth: 750, defaultHeight: 600 },
  { id: 'settings', name: 'Settings', icon: '⚙️', component: SettingsApp, defaultWidth: 750, defaultHeight: 600 },
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
    { id: 'git', name: 'Git Repos', icon: '🔗', component: GitIntegrationApp, defaultWidth: 850, defaultHeight: 600 },
    { id: 'pullrequests', name: 'Pull Requests', icon: '🔀', component: PullRequestDashboardApp, defaultWidth: 900, defaultHeight: 650 },
    { id: 'ci-pipelines', name: 'CI/CD Pipelines', icon: '⚙️', component: CIPipelineDashboardApp, defaultWidth: 900, defaultHeight: 650 },
  ],
  marketing: [
    { id: 'clients', name: 'Clients', icon: '🤝', component: ClientsApp, defaultWidth: 900, defaultHeight: 600 },
    { id: 'campaigns', name: 'Campaigns', icon: '📊', component: CampaignsApp, defaultWidth: 900, defaultHeight: 600 },
    { id: 'content', name: 'Content Hub', icon: '✏️', component: ContentHubApp, defaultWidth: 950, defaultHeight: 650 },
    { id: 'analytics', name: 'Analytics', icon: '📈', component: AnalyticsApp, defaultWidth: 900, defaultHeight: 650 },
    { id: 'invoices', name: 'Invoices', icon: '🧾', component: InvoicesApp, defaultWidth: 900, defaultHeight: 650 },
  ],
};

export function getDepartmentApps(department, role) {
  if (role === 'admin') {
    // Admin sees ALL department apps + admin panel + shared apps
    const allDeptApps = Object.values(departmentApps).flat();
    // Deduplicate by id
    const seen = new Set();
    const unique = [];
    for (const app of [...adminApps, ...allDeptApps, ...sharedApps]) {
      if (!seen.has(app.id)) {
        seen.add(app.id);
        unique.push(app);
      }
    }
    return unique;
  }
  const deptSpecific = departmentApps[department] || [];
  return [...deptSpecific, ...sharedApps];
}

export function getAllApps() {
  return sharedApps;
}
