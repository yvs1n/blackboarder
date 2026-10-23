/**
 * Blackboarder Mobile - Client Application
 * Touch-optimized companion with offline caching, live WebCal feed, and push notifications.
 */

const FIREBASE_DB_URL = 'https://blackboard-sidekick-default-rtdb.asia-southeast1.firebasedatabase.app';

/**
 * Retrieves the active Sync Pairing Key:
 * 1. Checks URL parameter ?key=..., ?sync=..., or ?code=... (and saves to localStorage if present)
 * 2. Checks localStorage('bbs_sync_key')
 */
let _justPairedViaUrl = false;

/** YYYY-MM-DD for the viewer's own time zone (an ISO string's date part is the UTC date). */
function localDateKey(input) {
  const d = input instanceof Date ? input : new Date(input);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Everything cached for one sync key must not leak into another account's cloud bucket when the
 * device is re-paired or disconnected.
 */
function resetLocalDataForNewKey() {
  [
    'bbs_mobile_tasks',
    'bbs_mobile_last_sync',
    'bbs_tombstones',
    'bbs_known_task_ids',
    'bbs_notified_map',
    'bbs_offline_mutation_queue',
    'bbs_quick_links'
  ].forEach(k => {
    try { localStorage.removeItem(k); } catch (e) {}
  });
}

function getSyncKey() {
  try {
    const params = new URLSearchParams(window.location.search);
    const urlKey = params.get('key') || params.get('sync') || params.get('code');
    if (urlKey && urlKey.trim()) {
      const clean = urlKey.trim().toUpperCase().replace(/[^a-zA-Z0-9_-]/g, '');
      if (clean) {
        const prevKey = localStorage.getItem('bbs_sync_key');
        if (prevKey !== clean) {
          if (prevKey) resetLocalDataForNewKey();
          _justPairedViaUrl = true;
        }
        localStorage.setItem('bbs_sync_key', clean);
        if (window.history && window.history.replaceState) {
          window.history.replaceState({}, document.title, window.location.pathname);
        }
        return clean;
      }
    }
    const saved = localStorage.getItem('bbs_sync_key');
    if (saved && saved.trim()) {
      return saved.trim().toUpperCase().replace(/[^a-zA-Z0-9_-]/g, '');
    }
  } catch (e) {}
  return '';
}

function getFirebaseDataUrl() {
  const key = getSyncKey();
  return key ? `${FIREBASE_DB_URL}/users/${key}/data.json` : null;
}

// ==========================================================================
// Dynamic Course Configurations, Schedules & Syllabus Mark Allocations
// ==========================================================================

// Shared logic: the extension's TypeScript core (src/), bundled into core.js by scripts/build.js and
// loaded before this file. Change behaviour there instead of re-implementing it here.
const BB = globalThis.BBCore;
const {
  sanitizeCloudTasks,
  safeHexColor,
  compileCoursePattern,
  compileSyllabusComponentMatcher,
  DEFAULT_USER_COURSES,
  extractRoomFromText,
  sanitizeDoctorAnnouncementText,
  extractExplicitPoints,
  extractAssessmentNumber,
  resolveTaskWeight,
  getCourseColorTheme,
  resolveCourseInfo,
  formatCountdown,
  createGoogleCalendarUrl,
  getTaskSortTimestamp,
  compareTasksByTime,
  normalizeAssessmentType,
  getTaskSeriesInfo,
  areTasksDuplicates,
  mergeDuplicatePair,
  deduplicateTaskList,
  isValidTask,
  matchesSelectedCourseFilter
} = BB;

// The shared versions return undefined for anything that is not a list; callers here expect a list
function sanitizeCloudQuickLinks(links) {
  return BB.sanitizeCloudQuickLinks(links) || [];
}

function sanitizeCloudCourses(courses) {
  return BB.sanitizeCloudCourses(courses) || [];
}

const DAY_ABBR = {
  Sunday: 'Sun',
  Monday: 'Mon',
  Tuesday: 'Tue',
  Wednesday: 'Wed',
  Thursday: 'Thu',
  Friday: 'Fri',
  Saturday: 'Sat'
};

// Runtime dynamic arrays consumed across mobile views
let PERMANENT_COURSE_LEGEND = [];
let STUDENT_CLASS_SCHEDULE = [];
let DEFAULT_SYLLABUS_DATABASE = [];
let SYLLABUS_INFO = [];

function recompileDynamicCourseData(courses) {
  const BLACKLIST_TABS = ['content', 'course content', 'calendar', 'discussions', 'gradebook', 'grades', 'messages', 'analytics', 'groups', 'announcements', 'roster', 'attendance', 'tools', 'stream', 'general course', 'uos'];
  const courseList = (Array.isArray(courses) ? courses : []).filter(c => {
    if (!c || typeof c !== 'object') return false;
    const n = (c.courseName || '').trim().toLowerCase();
    const cd = (c.courseCode || '').trim().toLowerCase();
    if (BLACKLIST_TABS.includes(n) && (!cd || BLACKLIST_TABS.includes(cd) || cd === n)) return false;
    return true;
  });

  // The shared core keeps the active courses; schedule lookups, weights and colours all read from it
  BB.setActiveUserCourses(sanitizeCloudCourses(courseList));

  // 1. Recompile PERMANENT_COURSE_LEGEND
  PERMANENT_COURSE_LEGEND.length = 0;
  PERMANENT_COURSE_LEGEND.push(...BB.getActiveCourseLegend().map(item => ({
    code: item.code,
    name: item.name,
    color: safeHexColor(item.hex),
    pattern: item.pattern
  })));

  // 2. Recompile STUDENT_CLASS_SCHEDULE (display fields on top of the shared entries)
  STUDENT_CLASS_SCHEDULE.length = 0;
  STUDENT_CLASS_SCHEDULE.push(...BB.getActiveScheduleEntries().map(entry => ({
    ...entry,
    days: (entry.days || []).map(d => DAY_ABBR[d] || d).join(' / '),
    time: entry.timeRangeDisplay,
    location: entry.location || entry.room
  })));

  // 3. Recompile DEFAULT_SYLLABUS_DATABASE
  DEFAULT_SYLLABUS_DATABASE.length = 0;
  DEFAULT_SYLLABUS_DATABASE.push(...BB.getActiveSyllabi());

  // 4. Recompile SYLLABUS_INFO
  const newSyllabusInfo = courseList.map(course => ({
    courseCode: course.courseCode,
    courseName: course.courseName,
    breakdown: (course.syllabus || []).map(comp => comp.note || `${comp.name}: ${comp.totalWeight}%${comp.count ? ` (${comp.count}x${comp.unitWeight}%)` : ''}`).join(', ')
  }));
  SYLLABUS_INFO.length = 0;
  SYLLABUS_INFO.push(...newSyllabusInfo);
}

function filterCleanMobileCourses(courses) {
  return BB.filterCleanUserCourses(courses);
}

function loadInitialUserCourses() {
  try {
    let syncKey = '';
    try {
      syncKey = (new URLSearchParams(window.location.search).get('key') || localStorage.getItem('bbs_sync_key') || '').trim().toUpperCase();
    } catch {}
    const scopedKey = syncKey ? `bbs_mobile_courses_${syncKey}` : null;
    const raw = (scopedKey ? localStorage.getItem(scopedKey) : null) || localStorage.getItem('bbs_mobile_courses');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return filterCleanMobileCourses(parsed);
      }
    }
  } catch (e) {
    console.warn('Failed to parse cached mobile courses:', e);
  }
  return [];
}

// Initialize active courses and dynamic data immediately on startup
const initialMobileCourses = loadInitialUserCourses();
recompileDynamicCourseData(initialMobileCourses);

/**
 * Room for a task: the room the professor announced, then the task's own room, then the class schedule.
 */
function resolveTaskRoom(task) {
  return BB.resolveTaskRoom({
    courseNameOrCode: `${task?.courseName || ''} ${task?.courseCode || ''}`.trim(),
    announcementText: `${task?.sourceSnippet || ''} ${task?.description || ''}`.trim(),
    title: task?.title || '',
    existingRoom: task?.room,
    type: task?.type || ''
  }).room;
}

// AI & Jev Configuration
const DEFAULT_AI_SETTINGS = {
  jevApiKey: '',
  useJevClassification: false,
  openRouterApiKey: '',
  openRouterModel: 'google/gemini-3.8-flash',
  useAiExtraction: false
};

function getAiSettings() {
  try {
    const raw = localStorage.getItem('bbs_ai_settings');
    if (raw) {
      return { ...DEFAULT_AI_SETTINGS, ...JSON.parse(raw) };
    }
  } catch (e) {}
  return { ...DEFAULT_AI_SETTINGS };
}

function saveAiSettings(settings) {
  try {
    const current = getAiSettings();
    const updated = { ...current, ...settings };
    localStorage.setItem('bbs_ai_settings', JSON.stringify(updated));
    return updated;
  } catch (e) {
    return DEFAULT_AI_SETTINGS;
  }
}

// Paste-an-announcement extraction runs the extension's pipeline: local parser, then the optional
// Jev classifier and OpenRouter model configured in Settings.
async function extractAnnouncementHybrid(text, courseHint = '') {
  return BB.extractFromText(text, courseHint, getAiSettings());
}

// Backup & Data Export Utilities
function exportJsonBackup() {
  const settings = getAiSettings();
  const backupData = {
    version: (typeof APP_BUILD !== 'undefined' && APP_BUILD.version) ? APP_BUILD.version : '1.1.0',
    exportedAt: new Date().toISOString(),
    tasks: state.tasks,
    settings
  };

  const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `blackboarder_backup_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Downloaded full JSON backup of your deadlines!');
}

async function handleRestoreJson(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!data.tasks || !Array.isArray(data.tasks)) {
      showToast('Invalid backup JSON file.');
      return;
    }

    // A backup file is untrusted input, so it gets the same checks as cloud data
    const restored = sanitizeCloudTasks(data.tasks).filter(t => t.title);
    const taskMap = new Map();
    state.tasks.forEach(t => taskMap.set(t.id, t));
    restored.forEach(t => taskMap.set(t.id, t));

    // syncToCloudAndLocal below saves the merged list
    state.tasks = Array.from(taskMap.values()).sort(compareTasksByTime);
    updateAllViews();

    if (data.settings) {
      saveAiSettings(data.settings);
    }

    await syncToCloudAndLocal();
    showToast(`Successfully restored ${restored.length} deadlines!`);
  } catch (err) {
    console.error('Restore error:', err);
    showToast('Failed to parse backup file.');
  }
}

function exportAllIcs() {
  const activeTasks = state.tasks.filter(t => t.status !== 'completed');
  if (activeTasks.length === 0) {
    showToast('No active deadlines to export.');
    return;
  }

  const icsContent = BB.generateIcsContent(activeTasks);

  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'blackboard_deadlines.ics';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('Downloaded blackboard_deadlines.ics file!');
}

function getCourseColor(courseCode = '', courseName = '', extraContext = '') {
  return safeHexColor(BB.getCourseHex(courseName, courseCode, extraContext));
}

function getSvgIcon(name, extraClass = '') {
  return `<svg class="ui-icon ${extraClass}"><use href="#icon-${name}"></use></svg>`;
}

function getTaskTypeIcon(type = '', extraClass = '') {
  switch ((type || '').toLowerCase()) {
    case 'quiz': return getSvgIcon('timer', extraClass);
    case 'assignment': return getSvgIcon('notebook-pen', extraClass);
    case 'exam': return getSvgIcon('list-check', extraClass);
    case 'project': return getSvgIcon('presentation', extraClass);
    case 'lab': return getSvgIcon('flask-conical', extraClass);
    case 'meeting': return getSvgIcon('users', extraClass);
    default: return getSvgIcon('pin', extraClass);
  }
}

// Academic Quick Links Defaults
const DEFAULT_QUICK_LINKS = [
  {
    id: 'ql_attendance',
    title: 'Attendance (Banner SSB)',
    url: 'https://banner.sharjah.ac.ae',
    category: 'attendance',
    createdAt: '2026-09-01T00:00:00.000Z'
  },
  {
    id: 'ql_study_plan',
    title: 'Study Plan & Degree Audit',
    url: 'https://banner.sharjah.ac.ae/StudentRegistrationSsb/',
    category: 'study_plan',
    createdAt: '2026-09-01T00:00:00.000Z'
  },
  {
    id: 'ql_marks',
    title: 'Final Marks & Academic Transcript',
    url: 'https://banner.sharjah.ac.ae',
    category: 'marks',
    createdAt: '2026-09-01T00:00:00.000Z'
  },
  {
    id: 'ql_blackboard',
    title: 'Blackboard Ultra Portal',
    url: 'https://elearning.sharjah.ac.ae/ultra/course',
    category: 'portal',
    createdAt: '2026-09-01T00:00:00.000Z'
  }
];

// Application State
const state = {
  tasks: [],
  quickLinks: [],
  userCourses: initialMobileCourses,
  coursesUpdatedAt: localStorage.getItem('bbs_mobile_courses_updated_at') || null,
  lastSync: null,
  currentDate: new Date(),
  displayedMonth: new Date(),
  selectedDay: null,
  selectedDate: null,
  selectedTaskId: null,
  selectedCourseFilter: null,
  filterStatus: 'pending',
  filterCourse: 'all',
  filterType: 'all',
  searchQuery: '',
  pushEnabled: false
};

// ==========================================================================
// Theme Management (Light / Dark / System)
// ==========================================================================
let currentTheme = 'light';

function applyTheme(theme = 'light') {
  currentTheme = theme;
  let isDark = false;
  if (theme === 'system') {
    isDark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  } else {
    isDark = theme === 'dark';
  }

  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');

  // Update meta theme-color for mobile address bar
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute('content', isDark ? '#121215' : '#18181b');
  }

  const btnToggle = document.getElementById('btn-web-theme-toggle');
  if (btnToggle) {
    btnToggle.innerHTML = isDark
      ? '<span class="theme-icon"><svg class="ui-icon"><use href="#icon-sun"></use></svg></span>'
      : '<span class="theme-icon"><svg class="ui-icon"><use href="#icon-moon"></use></svg></span>';
    btnToggle.title = isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode';
    btnToggle.setAttribute('aria-label', btnToggle.title);
  }

  const selectEl = document.getElementById('web-setting-theme');
  if (selectEl && selectEl.value !== theme) {
    selectEl.value = theme;
  }
}

function toggleTheme() {
  const isCurrentDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const newTheme = isCurrentDark ? 'light' : 'dark';
  applyTheme(newTheme);
  try {
    localStorage.setItem('bbs_theme', newTheme);
    const syncChannel = new BroadcastChannel('bbs_sync_channel');
    syncChannel.postMessage({ type: 'THEME_CHANGED', theme: newTheme });
    syncChannel.close();
  } catch (e) {}
}

function initTheme() {
  // Default is "Match System Theme". Older installs saved light/dark from the old
  // default or the removed header toggle, so switch everyone to System once.
  let saved = 'system';
  try {
    if (!localStorage.getItem('bbs_theme_system_default_v1')) {
      localStorage.setItem('bbs_theme', 'system');
      localStorage.setItem('bbs_theme_system_default_v1', '1');
    }
    saved = localStorage.getItem('bbs_theme') || 'system';
  } catch (e) {}

  applyTheme(saved);

  const btnToggle = document.getElementById('btn-web-theme-toggle');
  btnToggle?.addEventListener('click', toggleTheme);

  const btnSettingsToggle = document.getElementById('btn-settings-theme-toggle');
  btnSettingsToggle?.addEventListener('click', toggleTheme);

  const selectEl = document.getElementById('web-setting-theme');
  selectEl?.addEventListener('change', () => {
    const val = selectEl.value;
    applyTheme(val);
    try {
      localStorage.setItem('bbs_theme', val);
      const syncChannel = new BroadcastChannel('bbs_sync_channel');
      syncChannel.postMessage({ type: 'THEME_CHANGED', theme: val });
      syncChannel.close();
    } catch (e) {}
  });

  // System appearance change listener
  if (typeof window !== 'undefined' && window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (currentTheme === 'system') {
        applyTheme('system');
      }
    });
  }

  // Cross-tab and extension broadcast listener
  try {
    const syncChannel = new BroadcastChannel('bbs_sync_channel');
    syncChannel.onmessage = (event) => {
      if (event.data?.type === 'THEME_CHANGED' && event.data.theme) {
        applyTheme(event.data.theme);
      }
    };
  } catch (e) {}

  // Storage listener for cross-window sync
  window.addEventListener('storage', (e) => {
    if (e.key === 'bbs_theme' && e.newValue) {
      applyTheme(e.newValue);
    }
    if (e.key === 'bbs_quick_links' && e.newValue) {
      try {
        state.quickLinks = JSON.parse(e.newValue);
        renderQuickLinksBar();
        renderQuickLinksSchedule();
        renderQuickLinksManager();
      } catch (err) {}
    }
  });
}

// ==========================================================================
// Academic Quick Links Helpers & Controllers
// ==========================================================================
function getQuickLinkCategoryMeta(category) {
  switch (category) {
    case 'attendance':
      return { label: 'Attendance', icon: '📌', badgeClass: 'ql-cat-attendance', color: 'var(--text-main)', bg: 'var(--surface-hover)' };
    case 'study_plan':
      return { label: 'Study Plan', icon: '📋', badgeClass: 'ql-cat-study_plan', color: 'var(--text-main)', bg: 'var(--surface-hover)' };
    case 'marks':
      return { label: 'Marks', icon: '🏆', badgeClass: 'ql-cat-marks', color: 'var(--text-main)', bg: 'var(--surface-hover)' };
    case 'portal':
      return { label: 'Portal', icon: '🌐', badgeClass: 'ql-cat-portal', color: '#d97706', bg: '#fef3c7' };
    case 'other':
    default:
      return { label: 'Link', icon: '🔗', badgeClass: 'ql-cat-other', color: '#475569', bg: '#f1f5f9' };
  }
}

function openQuickLinkUrl(rawUrl) {
  let url = (rawUrl || '').trim();
  if (!url) return;
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = `https://${url}`;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

function loadCachedQuickLinks() {
  try {
    const raw = localStorage.getItem('bbs_quick_links');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        state.quickLinks = parsed;
        renderQuickLinksBar();
        renderQuickLinksSchedule();
        return;
      }
    }
  } catch (e) {
    console.warn('Failed to parse cached quick links:', e);
  }
  state.quickLinks = JSON.parse(JSON.stringify(DEFAULT_QUICK_LINKS));
  localStorage.setItem('bbs_quick_links', JSON.stringify(state.quickLinks));
  renderQuickLinksBar();
  renderQuickLinksSchedule();
}

function saveQuickLinks(links) {
  state.quickLinks = links;
  localStorage.setItem('bbs_quick_links', JSON.stringify(state.quickLinks));
  renderQuickLinksBar();
  renderQuickLinksSchedule();
  renderQuickLinksManager();
}

function renderQuickLinksBar() {
  const container = document.getElementById('calendar-quick-links-chips');
  if (!container) return;

  const links = state.quickLinks && state.quickLinks.length > 0 ? state.quickLinks : DEFAULT_QUICK_LINKS;

  if (links.length === 0) {
    container.innerHTML = `<span style="font-size: 11px; color: var(--text-muted); font-style: italic;">No quick links added yet. Click + Manage to add.</span>`;
    return;
  }

  container.innerHTML = links.map(link => {
    const meta = getQuickLinkCategoryMeta(link.category);
    return `
      <a class="ql-chip ${meta.badgeClass}" data-id="${escapeHtml(link.id)}" data-url="${escapeHtml(link.url)}" title="${escapeHtml(link.title)} (${escapeHtml(link.url)})">
        <span class="ql-chip-dot" style="background: ${meta.color};"></span>
        <span class="ql-chip-label">${escapeHtml(link.title)}</span>
        <svg class="ql-chip-external-icon"><use href="#icon-external-link"></use></svg>
      </a>
    `;
  }).join('');

  container.querySelectorAll('.ql-chip').forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.preventDefault();
      const url = chip.getAttribute('data-url');
      if (url) openQuickLinkUrl(url);
    });
  });
}

function renderQuickLinksSchedule() {
  const container = document.getElementById('schedule-quick-links-container');
  if (!container) return;

  const links = state.quickLinks && state.quickLinks.length > 0 ? state.quickLinks : DEFAULT_QUICK_LINKS;

  if (links.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 16px; color: var(--text-muted); font-size: 12px;">
        No quick links configured. Click <strong>+ Manage</strong> to add custom academic shortcuts.
      </div>
    `;
    return;
  }

  container.innerHTML = links.map(link => {
    const meta = getQuickLinkCategoryMeta(link.category);
    let hostname = '';
    try {
      const parsed = new URL(link.url.startsWith('http') ? link.url : `https://${link.url}`);
      hostname = parsed.hostname;
    } catch {
      hostname = link.url;
    }

    return `
      <div class="ql-item-card ${meta.badgeClass}" data-id="${escapeHtml(link.id)}" style="cursor: pointer;">
        <div class="ql-item-left">
          <div class="ql-item-icon-box" style="background: ${meta.bg}; color: ${meta.color};">
            ${meta.icon}
          </div>
          <div class="ql-item-info">
            <div class="ql-item-title-row">
              <span class="ql-item-title" title="${escapeHtml(link.title)}">${escapeHtml(link.title)}</span>
              <span class="ql-category-badge" style="background: ${meta.bg}; color: ${meta.color};">${meta.label}</span>
            </div>
            <span class="ql-item-url" title="${escapeHtml(link.url)}">${escapeHtml(hostname)}</span>
          </div>
        </div>
        <div class="ql-item-actions">
          <button type="button" class="btn-ql-open btn-open-link" data-url="${escapeHtml(link.url)}" title="Open in new tab">
            <span>Open</span>
            <svg class="ui-icon" style="width: 12px; height: 12px;"><use href="#icon-external-link"></use></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.btn-open-link').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const url = btn.getAttribute('data-url');
      if (url) openQuickLinkUrl(url);
    });
  });

  container.querySelectorAll('.ql-item-card').forEach(card => {
    card.addEventListener('click', () => {
      const linkId = card.getAttribute('data-id');
      const target = links.find(l => l.id === linkId);
      if (target && target.url) {
        openQuickLinkUrl(target.url);
      }
    });
  });
}

function renderQuickLinksManager() {
  const listContainer = document.getElementById('web-quick-links-manager-list');
  if (!listContainer) return;

  const links = state.quickLinks && state.quickLinks.length > 0 ? state.quickLinks : DEFAULT_QUICK_LINKS;

  if (links.length === 0) {
    listContainer.innerHTML = `
      <div style="text-align: center; padding: 20px 10px; color: var(--text-muted); font-size: 12px;">
        No quick links configured. Click <strong>Add Link</strong> or <strong>Reset Defaults</strong> to get started.
      </div>
    `;
    return;
  }

  listContainer.innerHTML = links.map(link => {
    const meta = getQuickLinkCategoryMeta(link.category);
    let hostname = '';
    try {
      const parsed = new URL(link.url.startsWith('http') ? link.url : `https://${link.url}`);
      hostname = parsed.hostname;
    } catch {
      hostname = link.url;
    }

    return `
      <div class="ql-item-card ${meta.badgeClass}" data-id="${escapeHtml(link.id)}">
        <div class="ql-item-left">
          <div class="ql-item-icon-box" style="background: ${meta.bg}; color: ${meta.color};">
            ${meta.icon}
          </div>
          <div class="ql-item-info">
            <div class="ql-item-title-row">
              <span class="ql-item-title" title="${escapeHtml(link.title)}">${escapeHtml(link.title)}</span>
              <span class="ql-category-badge" style="background: ${meta.bg}; color: ${meta.color};">${meta.label}</span>
            </div>
            <span class="ql-item-url" title="${escapeHtml(link.url)}">${escapeHtml(hostname)}</span>
          </div>
        </div>
        <div class="ql-item-actions">
          <button type="button" class="btn-ql-open btn-open-link" data-url="${escapeHtml(link.url)}" title="Open in new tab">
            <span>Open</span>
            <svg class="ui-icon" style="width: 12px; height: 12px;"><use href="#icon-external-link"></use></svg>
          </button>
          <button type="button" class="btn-ql-action btn-edit-ql" data-id="${escapeHtml(link.id)}" title="Edit link" aria-label="Edit link">
            <svg class="ui-icon" style="width: 12px; height: 12px;"><use href="#icon-pencil"></use></svg>
          </button>
          <button type="button" class="btn-ql-action delete btn-delete-ql" data-id="${escapeHtml(link.id)}" title="Delete link" aria-label="Delete link">
            <svg class="ui-icon" style="width: 12px; height: 12px;"><use href="#icon-trash"></use></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Wire open
  listContainer.querySelectorAll('.btn-open-link').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const url = btn.getAttribute('data-url');
      if (url) openQuickLinkUrl(url);
    });
  });

  // Wire edit
  listContainer.querySelectorAll('.btn-edit-ql').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      const target = state.quickLinks.find(l => l.id === id);
      if (!target) return;

      const form = document.getElementById('form-web-quick-link');
      const editIdInput = document.getElementById('web-ql-edit-id');
      const titleInput = document.getElementById('web-ql-title');
      const urlInput = document.getElementById('web-ql-url');
      const catSelect = document.getElementById('web-ql-category');
      const saveBtn = document.getElementById('btn-save-web-ql');

      if (form && editIdInput && titleInput && urlInput && catSelect) {
        editIdInput.value = target.id;
        titleInput.value = target.title;
        urlInput.value = target.url;
        catSelect.value = target.category || 'other';
        if (saveBtn) saveBtn.textContent = 'Update Link';
        form.style.display = 'block';
        titleInput.focus();
      }
    });
  });

  // Wire delete
  listContainer.querySelectorAll('.btn-delete-ql').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.getAttribute('data-id');
      if (!id) return;
      const target = state.quickLinks.find(l => l.id === id);
      const title = target ? target.title : 'link';

      state.quickLinks = state.quickLinks.filter(l => l.id !== id);
      saveQuickLinks(state.quickLinks);
      await syncToCloudAndLocal();
      showToast(`Removed "${title}" from quick links`);
    });
  });
}

function openQuickLinksModal() {
  const modal = document.getElementById('modal-quick-links');
  if (modal) {
    modal.style.display = 'flex';
    modal.classList.remove('hidden');
    renderQuickLinksManager();
  }
}

function closeQuickLinksModal() {
  const modal = document.getElementById('modal-quick-links');
  const form = document.getElementById('form-web-quick-link');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.add('hidden');
  }
  if (form) {
    form.reset();
    form.style.display = 'none';
    const editId = document.getElementById('web-ql-edit-id');
    if (editId) editId.value = '';
    const saveBtn = document.getElementById('btn-save-web-ql');
    if (saveBtn) saveBtn.textContent = 'Save Link';
  }
}

function initQuickLinksModal() {
  const modal = document.getElementById('modal-quick-links');
  const btnWebHeader = document.getElementById('btn-web-quick-links');
  const btnBarManage = document.getElementById('btn-web-bar-manage-links');
  const btnScheduleManage = document.getElementById('btn-web-schedule-manage-links');
  const btnClose = document.getElementById('btn-close-web-quick-links');
  const btnToggleForm = document.getElementById('btn-web-toggle-add-link-form');
  const btnReset = document.getElementById('btn-web-reset-quick-links');
  const form = document.getElementById('form-web-quick-link');
  const btnCancelForm = document.getElementById('btn-cancel-web-ql-form');

  btnWebHeader?.addEventListener('click', openQuickLinksModal);
  btnBarManage?.addEventListener('click', openQuickLinksModal);
  btnScheduleManage?.addEventListener('click', openQuickLinksModal);
  btnClose?.addEventListener('click', closeQuickLinksModal);

  modal?.addEventListener('click', (e) => {
    if (e.target === modal) closeQuickLinksModal();
  });

  btnToggleForm?.addEventListener('click', () => {
    if (form) {
      const isVisible = form.style.display !== 'none';
      if (isVisible) {
        form.style.display = 'none';
      } else {
        form.reset();
        const editId = document.getElementById('web-ql-edit-id');
        if (editId) editId.value = '';
        const saveBtn = document.getElementById('btn-save-web-ql');
        if (saveBtn) saveBtn.textContent = 'Save Link';
        form.style.display = 'block';
        document.getElementById('web-ql-title')?.focus();
      }
    }
  });

  btnCancelForm?.addEventListener('click', () => {
    if (form) {
      form.reset();
      form.style.display = 'none';
      const editId = document.getElementById('web-ql-edit-id');
      if (editId) editId.value = '';
    }
  });

  // Preset chips
  modal?.querySelectorAll('.btn-preset-ql').forEach(btn => {
    btn.addEventListener('click', () => {
      const preset = btn.getAttribute('data-preset');
      const titleInput = document.getElementById('web-ql-title');
      const urlInput = document.getElementById('web-ql-url');
      const catSelect = document.getElementById('web-ql-category');

      if (form) form.style.display = 'block';

      if (preset === 'attendance') {
        if (titleInput) titleInput.value = 'Attendance (Banner)';
        if (urlInput) urlInput.value = 'https://banner.sharjah.ac.ae';
        if (catSelect) catSelect.value = 'attendance';
      } else if (preset === 'study_plan') {
        if (titleInput) titleInput.value = 'Study Plan & Degree Audit';
        if (urlInput) urlInput.value = 'https://banner.sharjah.ac.ae/StudentRegistrationSsb/';
        if (catSelect) catSelect.value = 'study_plan';
      } else if (preset === 'marks') {
        if (titleInput) titleInput.value = 'Final Marks & Transcript';
        if (urlInput) urlInput.value = 'https://banner.sharjah.ac.ae';
        if (catSelect) catSelect.value = 'marks';
      } else if (preset === 'portal') {
        if (titleInput) titleInput.value = 'Blackboard Ultra Portal';
        if (urlInput) urlInput.value = 'https://elearning.sharjah.ac.ae/ultra/course';
        if (catSelect) catSelect.value = 'portal';
      }
    });
  });

  // Reset defaults
  btnReset?.addEventListener('click', async () => {
    if (confirm('Reset quick links to standard university presets?')) {
      state.quickLinks = JSON.parse(JSON.stringify(DEFAULT_QUICK_LINKS));
      saveQuickLinks(state.quickLinks);
      await syncToCloudAndLocal();
      showToast('Quick links reset to defaults');
    }
  });

  // Form submit
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const editId = document.getElementById('web-ql-edit-id')?.value || '';
    const title = document.getElementById('web-ql-title')?.value.trim() || '';
    let url = document.getElementById('web-ql-url')?.value.trim() || '';
    const category = document.getElementById('web-ql-category')?.value || 'other';

    if (!title || !url) {
      showToast('Please provide both title and URL.');
      return;
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }

    if (editId) {
      const idx = state.quickLinks.findIndex(l => l.id === editId);
      if (idx !== -1) {
        state.quickLinks[idx] = {
          ...state.quickLinks[idx],
          title,
          url,
          category,
          updatedAt: new Date().toISOString()
        };
      }
      showToast(`Updated "${title}"`);
    } else {
      const newLink = {
        id: `ql_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        title,
        url,
        category,
        createdAt: new Date().toISOString()
      };
      state.quickLinks.push(newLink);
      showToast(`Added "${title}" to quick links!`);
    }

    form.reset();
    form.style.display = 'none';
    const idInput = document.getElementById('web-ql-edit-id');
    if (idInput) idInput.value = '';

    saveQuickLinks(state.quickLinks);
    await syncToCloudAndLocal();
  });
}

// ==========================================================================
// Initialization
// ==========================================================================
function initApp() {
  initTheme();
  initServiceWorker();
  initTabs();
  initCalendar();
  initLegend();
  initScheduleAndSyllabus();
  updateCourseDatalist();
  initDeadlinesControls();
  initSettings();
  initDaySheet();
  initSelectedDayContainer();
  initOnlineListeners();
  initModals();
  initGradeTracker();
  initQuickLinksModal();

  // 1. Immediately & synchronously load cached quick links & tasks (<2ms)
  loadCachedQuickLinks();
  loadCachedTasks();

  // 2. Render all views immediately so the dashboard appears instantly populated like on the extension
  updateAllViews();
  updateSyncBanner();

  // 3. Proactively refresh data in the background non-blockingly without layout jumps
  refreshDataInBackground();

  if (_justPairedViaUrl) {
    const key = getSyncKey();
    if (key) {
      showToast(`✓ Paired with extension (Key: ${key})!`);
    }
    _justPairedViaUrl = false;
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}

async function refreshDataInBackground() {
  await fetchTasksFromServer(false);
}

// Filled in by scripts/build.js. The server's version.json describes the deployed build the same way.
const APP_BUILD = {"build":"a3fbc86cc01f","version":"1.1.0","shortCommit":"db322da","timestamp":"2026-10-23T09:41:17.375Z"};

const UPDATE_CHECK_INTERVAL_MS = 15 * 60 * 1000;

/** Reads version.json from the server, skipping every cache. */
async function fetchDeployedVersion() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);
    const res = await fetch('./version.json?t=' + Date.now(), { cache: 'no-store', signal: controller.signal });
    clearTimeout(timeoutId);
    if (!res.ok) return null;
    const data = await res.json();
    return data && typeof data.build === 'string' && data.build ? data : null;
  } catch (e) {
    return null;
  }
}

/** True when the deployed build differs from the running one and is not older (a stale cache can serve old files). */
function isDeployedBuildNewer(remote, local = APP_BUILD) {
  if (!remote || !remote.build || !local || !local.build) return false;
  if (remote.build === local.build) return false;
  const remoteTime = Date.parse(remote.timestamp || '') || 0;
  const localTime = Date.parse(local.timestamp || '') || 0;
  return !(remoteTime && localTime && remoteTime < localTime);
}

/** True while the user is typing or has a dialog open, so a reload would lose what they are doing. */
function isUserBusy() {
  const active = document.activeElement;
  if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT' || active.isContentEditable)) {
    return true;
  }
  if (document.querySelector('.modal-backdrop:not(.hidden)')) return true;
  return Array.from(document.querySelectorAll('textarea')).some(t => t.value.trim() !== '');
}

/*
 * The web app updates itself, like a store-installed extension: GitHub pushes deploy to Cloudflare
 * Pages, and the app compares its build with the deployed version.json. A newer build is loaded
 * right away when the app opens or comes back to the foreground (unless the user is busy), or
 * when the tab is hidden. While the user is working it only shows the update banner.
 */
function initServiceWorker() {
  let swReg = null;
  let pendingBuild = null;
  let applying = false;

  try {
    const currentUrl = new URL(window.location.href);
    if (currentUrl.searchParams.has('upd')) {
      currentUrl.searchParams.delete('upd');
      window.history.replaceState({}, document.title, currentUrl.pathname + currentUrl.search + currentUrl.hash);
    }
    if (sessionStorage.getItem('bbs_just_updated') === 'true') {
      sessionStorage.removeItem('bbs_just_updated');
      setTimeout(() => showToast('Blackboarder updated to the latest version. Your data is intact.'), 500);
    }
  } catch (e) {}

  const versionPrefix = APP_BUILD.version ? 'v' + APP_BUILD.version + ' · ' : '';
  const buildLabel = APP_BUILD.build
    ? `${versionPrefix}build ${APP_BUILD.build}${APP_BUILD.shortCommit ? ' · ' + APP_BUILD.shortCommit : ''}`
    : 'development build';
  const verEl = document.getElementById('app-version-label');
  if (verEl) verEl.textContent = `(${buildLabel})`;

  const setStatus = text => {
    const status = document.getElementById('app-update-status');
    if (status) status.textContent = text;
  };

  const showUpdateUi = available => {
    const banner = document.getElementById('app-update-banner');
    if (banner) banner.hidden = !available;
    const applyBtn = document.getElementById('btn-apply-update');
    if (applyBtn) applyBtn.hidden = !available;
    setStatus(available
      ? 'A new version is ready. It installs by itself next time you leave or reopen the app, or tap Update Now.'
      : `Updates install automatically. You are on the latest version (${buildLabel}).`);
  };

  // Let a new service worker take over before reloading, so it serves the new files
  const waitForNewWorker = () => new Promise(resolve => {
    if (!swReg || !navigator.serviceWorker?.controller || !(swReg.installing || swReg.waiting)) {
      resolve();
      return;
    }
    const timeoutId = setTimeout(resolve, 5000);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      clearTimeout(timeoutId);
      resolve();
    }, { once: true });
    swReg.waiting?.postMessage({ type: 'SKIP_WAITING' });
  });

  const applyUpdate = async () => {
    if (applying) return;
    applying = true;
    try {
      // Remembered so a reload that still gets old files does not loop
      sessionStorage.setItem('bbs_update_tried', pendingBuild?.build || '');
      sessionStorage.setItem('bbs_just_updated', 'true');
    } catch (e) {}
    setStatus('Updating... Your data stays intact.');
    if (swReg) {
      try { await swReg.update(); } catch (e) {}
    }
    await waitForNewWorker();
    const url = new URL(window.location.href);
    url.searchParams.set('upd', Date.now().toString());
    window.location.replace(url.toString());
  };

  const alreadyTried = build => {
    try {
      return sessionStorage.getItem('bbs_update_tried') === build;
    } catch (e) {
      return false;
    }
  };

  // mode: 'manual' (button), 'quiet' (app opened or brought back) or 'background' (timer)
  const checkForUpdate = async mode => {
    if (applying) return;
    if (mode === 'manual') setStatus('Checking for updates...');
    const remote = await fetchDeployedVersion();
    if (!isDeployedBuildNewer(remote)) {
      pendingBuild = null;
      showUpdateUi(false);
      if (mode === 'manual') {
        if (!remote) setStatus('Could not reach the server. Updates will install once you are online.');
        showToast(remote ? 'You are on the latest version of Blackboarder!' : 'Could not check for updates right now.');
      }
      return;
    }
    pendingBuild = remote;
    if (mode === 'manual') {
      applyUpdate();
      return;
    }
    const canApplyNow = !alreadyTried(remote.build) &&
      (document.visibilityState === 'hidden' || (mode === 'quiet' && !isUserBusy()));
    if (canApplyNow) {
      applyUpdate();
    } else {
      showUpdateUi(true);
    }
  };

  document.getElementById('btn-apply-update')?.addEventListener('click', applyUpdate);
  document.getElementById('btn-update-banner-apply')?.addEventListener('click', applyUpdate);
  document.getElementById('btn-update-banner-dismiss')?.addEventListener('click', () => {
    const banner = document.getElementById('app-update-banner');
    if (banner) banner.hidden = true;
  });
  document.getElementById('btn-check-update')?.addEventListener('click', () => checkForUpdate('manual'));
  showUpdateUi(false);

  setTimeout(() => checkForUpdate('quiet'), 800);
  setInterval(() => checkForUpdate('background'), UPDATE_CHECK_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkForUpdate('quiet');
    } else if (pendingBuild && !alreadyTried(pendingBuild.build)) {
      applyUpdate();
    }
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        console.log('[SW] Registered successfully:', reg.scope);
        swReg = reg;
        reg.update?.().catch(() => {});
        registerPeriodicSync();
        syncTasksToServiceWorker();
      })
      .catch(err => {
        console.warn('[SW] Registration failed:', err);
      });

    // Handle clicks from Service Worker notifications
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'OPEN_TASK' && event.data.taskId) {
        const target = (state.tasks || []).find(t => t.id === event.data.taskId);
        if (target) {
          openReadingSheet(target);
        }
      }
    });
  }
}

// ==========================================================================
// Notifications & Background Deadline Scheduler
// ==========================================================================

async function sendMobileNotification(title, options = {}) {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return false;
  }
  const isEnabled = localStorage.getItem('bbs_push_enabled') === 'true';
  if (!isEnabled) return false;

  const notifOptions = {
    icon: './icon-192.png',
    badge: './icon-192.png',
    vibrate: [200, 100, 200],
    data: { url: './index.html' },
    ...options
  };

  // 1. Mobile PWA / Service Worker (Android Chrome & iOS Safari compliant)
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (reg && reg.showNotification) {
        await reg.showNotification(title, notifOptions);
        return true;
      }
    } catch (swErr) {
      console.warn('[Notif] Service Worker showNotification failed:', swErr);
    }
  }

  // 2. Fallback to standard Desktop constructor
  try {
    new Notification(title, notifOptions);
    return true;
  } catch (err) {
    console.warn('[Notif] Desktop Notification constructor failed:', err);
    return false;
  }
}

function getNotifAdvanceHours() {
  const v = localStorage.getItem('bbs_notif_advance_hours');
  return v !== null ? parseFloat(v) : 24;
}

function getNotifUrgentHours() {
  const v = localStorage.getItem('bbs_notif_urgent_hours');
  return v !== null ? parseFloat(v) : 2;
}

function getNotifDueAlertEnabled() {
  const v = localStorage.getItem('bbs_notif_due_alert');
  return v !== null ? v === 'true' : true;
}

function syncTasksToServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const pushEnabled = localStorage.getItem('bbs_push_enabled') === 'true';
  const notifiedRaw = localStorage.getItem('bbs_notified_map') || '{}';
  let notifiedMap = {};
  try { notifiedMap = JSON.parse(notifiedRaw); } catch (e) {}

  const messageData = {
    type: 'SYNC_TASKS_FOR_NOTIFICATIONS',
    tasks: state.tasks || [],
    notifiedMap,
    enabled: pushEnabled,
    advanceHours: getNotifAdvanceHours(),
    urgentHours: getNotifUrgentHours(),
    dueAlertEnabled: getNotifDueAlertEnabled()
  };

  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage(messageData);
  } else {
    navigator.serviceWorker.ready.then(reg => {
      reg.active?.postMessage(messageData);
    }).catch(() => {});
  }
}

async function registerPeriodicSync() {
  if ('serviceWorker' in navigator && 'periodicSync' in navigator.serviceWorker) {
    try {
      const reg = await navigator.serviceWorker.ready;
      const tags = await reg.periodicSync.getTags();
      if (!tags.includes('check-deadlines')) {
        await reg.periodicSync.register('check-deadlines', {
          minInterval: 15 * 60 * 1000
        });
        console.log('[SW] Periodic sync registered');
      }
    } catch (err) {
      console.log('[SW] Periodic sync not available or denied:', err.message);
    }
  }
}

function formatNotificationPayload(task, windowType, timeRemaining) {
  const resolved = resolveCourseInfo(task);
  const courseDisplay = resolved.courseCode && resolved.courseCode.toLowerCase() !== 'uos'
    ? `${resolved.courseName} (${resolved.courseCode})`
    : resolved.courseName;

  const dueDateObj = new Date(task.dueDate);
  const timeStr = !isNaN(dueDateObj) ? dueDateObj.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  const dateStr = !isNaN(dueDateObj) ? dueDateObj.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : '';

  const room = task.room || resolveTaskRoom(task);
  let locationStr = '';
  if (room) {
    locationStr = `📍 Room: ${room}`;
  } else if (task.type === 'exam' || task.type === 'quiz') {
    locationStr = '📍 In-class on paper';
  } else {
    locationStr = '💻 Online Submission on Blackboard';
  }

  const weightStr = task.weight ? ` • Worth ${task.weight}%` : '';

  let title = '';
  let timeDesc = '';
  if (windowType === 'due') {
    title = `⏳ Due Now: ${task.title}`;
    timeDesc = `🕒 Due time has arrived (${dateStr} at ${timeStr})`;
  } else if (timeRemaining <= 4 * 3600 * 1000) {
    const minsLeft = Math.max(1, Math.round(timeRemaining / (60 * 1000)));
    const countdownStr = minsLeft >= 60 ? `about ${Math.round(minsLeft / 60)} hour(s)` : `${minsLeft} minutes`;
    title = `🚨 Urgent (${windowType}): ${task.title}`;
    timeDesc = `🕒 Due: ${dateStr} at ${timeStr} (in ${countdownStr})`;
  } else {
    const hoursLeft = Math.max(1, Math.round(timeRemaining / (3600 * 1000)));
    title = `⏰ Reminder (${windowType}): ${task.title}`;
    timeDesc = `🕒 Due: ${dateStr} at ${timeStr} (~${hoursLeft}h left)`;
  }

  const body = `${courseDisplay}${weightStr}\n${timeDesc}\n${locationStr}`;

  return { title, body };
}

async function checkUpcomingDeadlines(isInteractive = false) {
  if (!('Notification' in window) || Notification.permission !== 'granted') {
    return;
  }
  const isEnabled = localStorage.getItem('bbs_push_enabled') === 'true';
  if (!isEnabled) return;

  const advanceHours = getNotifAdvanceHours();
  const urgentHours = getNotifUrgentHours();
  const dueAlertEnabled = getNotifDueAlertEnabled();

  const now = Date.now();
  const notifiedRaw = localStorage.getItem('bbs_notified_map') || '{}';
  let notifiedMap = {};
  try { notifiedMap = JSON.parse(notifiedRaw); } catch (e) {}

  let changed = false;
  let notificationsTriggered = 0;

  for (const task of (state.tasks || [])) {
    if (task.status === 'completed') continue;
    if (!isValidTask(task)) continue;
    const dueTime = new Date(task.dueDate).getTime();
    if (isNaN(dueTime)) continue;

    const timeRemaining = dueTime - now;

    // 1. Advance Reminder
    if (advanceHours > 0) {
      const advanceMs = advanceHours * 3600 * 1000;
      const lowerBoundMs = Math.max(urgentHours * 3600 * 1000, 0);
      if (timeRemaining > lowerBoundMs && timeRemaining <= advanceMs) {
        const key = `${task.id}_adv_${advanceHours}h`;
        const last = notifiedMap[key] || 0;
        if (now - last > Math.max((advanceHours * 0.75) * 3600 * 1000, 3600 * 1000)) {
          notifiedMap[key] = now;
          changed = true;
          notificationsTriggered++;
          const label = advanceHours >= 24 ? `${Math.round(advanceHours / 24)}d` : `${advanceHours}h`;
          const { title, body } = formatNotificationPayload(task, label, timeRemaining);
          await sendMobileNotification(title, {
            body,
            tag: `bbs-adv-${task.id}`,
            renotify: false,
            vibrate: [200, 100, 200],
            data: { url: './index.html', taskId: task.id }
          });
        }
      }
    }

    // 2. Urgent Countdown Alert
    if (urgentHours > 0) {
      const urgentMs = urgentHours * 3600 * 1000;
      if (timeRemaining > 0 && timeRemaining <= urgentMs) {
        const key = `${task.id}_urg_${urgentHours}h`;
        const last = notifiedMap[key] || 0;
        if (now - last > Math.max((urgentHours * 0.75) * 3600 * 1000, 30 * 60 * 1000)) {
          notifiedMap[key] = now;
          changed = true;
          notificationsTriggered++;
          const label = urgentHours < 1 ? `${Math.round(urgentHours * 60)}m` : `${urgentHours}h`;
          const { title, body } = formatNotificationPayload(task, label, timeRemaining);
          await sendMobileNotification(title, {
            body,
            tag: `bbs-urg-${task.id}`,
            renotify: false,
            vibrate: [300, 150, 300],
            data: { url: './index.html', taskId: task.id }
          });
        }
      }
    }

    // 3. Due Now / Closing (0 to -30m)
    if (dueAlertEnabled && timeRemaining <= 0 && timeRemaining >= -6 * 3600 * 1000) {
      const key = `${task.id}_due`;
      const last = notifiedMap[key] || 0;
      if (now - last > 2 * 3600 * 1000) {
        notifiedMap[key] = now;
        changed = true;
        notificationsTriggered++;
        const { title, body } = formatNotificationPayload(task, 'due', timeRemaining);
        await sendMobileNotification(title, {
          body,
          tag: `bbs-due-${task.id}`,
          renotify: false,
          vibrate: [200, 100, 200],
          data: { url: './index.html', taskId: task.id }
        });
      }
    }
  }

  if (changed) {
    localStorage.setItem('bbs_notified_map', JSON.stringify(notifiedMap));
    syncTasksToServiceWorker();
  }

  if (isInteractive && notificationsTriggered === 0) {
    console.log('[Notif] Deadline check completed: No active deadlines within notification window.');
  }
}

// Wide desktop (900px+): the calendar and the deadline list sit side by side as one
// "dashboard" view, with Up Next under the calendar. Matches the CSS breakpoint.
const DASHBOARD_MEDIA = '(min-width: 900px)';
function isDashboardLayout() {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(DASHBOARD_MEDIA).matches;
}

// Switch Active View
function switchView(targetViewId) {
  if (targetViewId === 'view-deadlines' && isDashboardLayout()) {
    targetViewId = 'view-calendar';
  }
  const tabButtons = document.querySelectorAll('.nav-item');
  const sections = document.querySelectorAll('.view-section');
  document.querySelector('.app-main')?.classList.toggle('is-dashboard', targetViewId === 'view-calendar');

  tabButtons.forEach(b => {
    const isTarget = b.getAttribute('data-view') === targetViewId;
    b.classList.toggle('active', isTarget);
    b.setAttribute('aria-selected', isTarget ? 'true' : 'false');
  });

  sections.forEach(s => {
    s.classList.toggle('active', s.id === targetViewId);
  });

  // If switching to calendar, re-render to update layout
  if (targetViewId === 'view-calendar') {
    renderCalendar();
  }
}

// Navigation Tabs & Header Shortcuts
function initTabs() {
  const tabButtons = document.querySelectorAll('.nav-item');
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetViewId = btn.getAttribute('data-view');
      if (targetViewId) {
        switchView(targetViewId);
      }
    });
  });

  // Widening the window while the deadline list is open folds it into the dashboard
  if (typeof window !== 'undefined' && window.matchMedia) {
    window.matchMedia(DASHBOARD_MEDIA).addEventListener('change', (e) => {
      if (e.matches && document.getElementById('view-deadlines')?.classList.contains('active')) {
        switchView('view-calendar');
      }
    });
  }

  // Desktop action button shortcuts
  document.getElementById('btn-web-schedule')?.addEventListener('click', () => {
    switchView('view-schedule');
  });

  document.getElementById('btn-web-settings')?.addEventListener('click', () => {
    switchView('view-settings');
  });

  document.getElementById('btn-web-add')?.addEventListener('click', () => {
    openAddTaskModal(state.selectedDate || localDateKey(new Date()));
  });
}

// ==========================================================================
// Data Fetching & Sync
// ==========================================================================
function updateCourseDatalist() {
  const datalist = document.getElementById('course-datalist-options');
  if (!datalist) return;
  const optionsHtml = (state.userCourses || []).map(c =>
    `<option value="${escapeHtml(c.courseName)}">${escapeHtml(c.courseCode)}</option>`
  ).join('');
  datalist.innerHTML = optionsHtml;
}

function recalculateAllTaskWeightsAndRooms() {
  if (!Array.isArray(state.tasks) || state.tasks.length === 0) return;
  recalculateTaskList(state.tasks);
}

/** Fills in course names, rooms, cleaned text and syllabus weights for every task in the list (in place). */
function recalculateTaskList(tasks) {
  tasks.forEach(t => {
    if (t.courseCode === 'UOS') t.courseCode = '';
    const resolved = resolveCourseInfo(t);
    if (resolved.courseName !== 'General Course' && (!t.courseName || t.courseName === 'General Course' || t.courseName.toLowerCase() === 'uos')) {
      t.courseName = resolved.courseName;
    }
    if (resolved.courseCode && !t.courseCode) {
      t.courseCode = resolved.courseCode;
    }
    const cleanT = (t.type || '').toLowerCase();
    const isHwOrProj = cleanT === 'assignment' || cleanT === 'hw' || cleanT === 'project';
    if (isHwOrProj) {
      t.room = undefined;
    } else if (!BB.isPlausibleRoom(t.room) && !t.userEdited && t.extractedBy !== 'manual' || !t.room) {
      // A missing or junk room ("s", "Please") is looked up again
      const r = resolveTaskRoom(t);
      if (r) t.room = r;
    }
    if (t.description) {
      t.description = sanitizeDoctorAnnouncementText(t.description, t.courseName, t.courseCode, t.title);
    }
    if (t.sourceSnippet) {
      t.sourceSnippet = sanitizeDoctorAnnouncementText(t.sourceSnippet, t.courseName, t.courseCode, t.title);
    }
    const seriesInfo = getTaskSeriesInfo(t, tasks);
    const wInfo = resolveTaskWeight(
      t.courseName || t.courseCode,
      t.title,
      t.type,
      t.sourceSnippet || t.description || t.notes || '',
      seriesInfo?.index
    );
    // Only fill a missing weight: the extension decides weights, so the two never disagree and flip-flop through sync
    if (wInfo.weight !== undefined && t.weight === undefined && !t.userEdited && t.extractedBy !== 'manual') {
      t.weight = wInfo.weight;
      t.weightDisplay = wInfo.weightDisplay;
      t.syllabusNote = wInfo.syllabusNote;
    }
  });
}

function loadCachedTasks() {
  try {
    const cachedRaw = localStorage.getItem('bbs_mobile_tasks');
    const cachedSync = localStorage.getItem('bbs_mobile_last_sync');
    if (cachedRaw) {
      state.tasks = (JSON.parse(cachedRaw) || []).filter(isValidTask);
      state.tasks.sort(compareTasksByTime);
      state.lastSync = cachedSync;

      recalculateAllTaskWeightsAndRooms();

      syncTasksToServiceWorker();
      checkUpcomingDeadlines(false);
    }
  } catch (err) {
    console.error('Error loading cached tasks:', err);
  }
}

function recordLocalTombstone(taskId) {
  try {
    const raw = localStorage.getItem('bbs_tombstones') || '{}';
    const tombs = JSON.parse(raw);
    tombs[taskId] = new Date().toISOString();
    localStorage.setItem('bbs_tombstones', JSON.stringify(tombs));
  } catch (e) {}
}

function removeLocalTombstone(taskId) {
  try {
    const raw = localStorage.getItem('bbs_tombstones') || '{}';
    const tombs = JSON.parse(raw);
    delete tombs[taskId];
    localStorage.setItem('bbs_tombstones', JSON.stringify(tombs));
  } catch (e) {}
}

function getLocalTombstones() {
  try {
    const raw = localStorage.getItem('bbs_tombstones') || '{}';
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

let _isFetchingFromServer = false;

async function fetchTasksFromServer(isManual = false) {
  if (_isFetchingFromServer && !isManual) return;
  _isFetchingFromServer = true;
  const refreshBtn = document.getElementById('btn-refresh');
  const syncBanner = document.getElementById('sync-banner-text');

  // Only show spinning indicator and override banner text during manual user sync
  if (isManual) {
    refreshBtn?.querySelector('.refresh-icon')?.classList.add('refresh-spinning');
    if (syncBanner) syncBanner.textContent = 'Syncing deadlines with Firebase Cloud...';
  }

  try {
    let tasksLoaded = false;
    let fetchedTasks = [];
    let fetchedSync = null;
    let fetchedQuickLinks = null;

    const activeKey = getSyncKey();
    if (!activeKey) {
      // Un-paired state: do not query unkeyed root data
      updateSyncBanner();
      renderDeadlines();
      renderCalendar();
      return;
    }

    let fetchedCourses = null;
    let fetchedCoursesUpdatedAt = null;

    // 1. Fetch directly from Firebase Realtime Database (24/7 online even if laptop is off)
    try {
      const fbUrl = getFirebaseDataUrl();
      if (fbUrl) {
        const fbRes = await fetch(fbUrl, { cache: 'no-store' });
        if (fbRes.ok) {
          const fbData = await fbRes.json();
          if (fbData) {
            if (Array.isArray(fbData.courses)) {
              fetchedCourses = sanitizeCloudCourses(fbData.courses);
              fetchedCoursesUpdatedAt = fbData.coursesUpdatedAt || null;
            }
            // Firebase drops empty arrays, so a saved empty list arrives with lastSync but no tasks
            if (Array.isArray(fbData.tasks) || fbData.lastSync) {
              fetchedTasks = sanitizeCloudTasks(fbData.tasks || []);
              fetchedSync = fbData.lastSync || new Date().toISOString();
              tasksLoaded = true;
              if (Array.isArray(fbData.quickLinks) && fbData.quickLinks.length > 0) {
                fetchedQuickLinks = sanitizeCloudQuickLinks(fbData.quickLinks);
              }
              if (fbData.tombstones && typeof fbData.tombstones === 'object') {
                const tombs = getLocalTombstones();
                for (const [tombId, tombTime] of Object.entries(BB.decodeCloudKeys(fbData.tombstones))) {
                  if (!tombs[tombId] || new Date(tombTime).getTime() > new Date(tombs[tombId]).getTime()) {
                    tombs[tombId] = tombTime;
                  }
                }
                localStorage.setItem('bbs_tombstones', JSON.stringify(tombs));
              }
            }
          }
        }
      }
    } catch (fbErr) {
      console.warn('Direct Firebase fetch unavailable, trying edge API:', fbErr);
    }

    // 2. Fallback to Cloudflare edge /api/tasks
    if (!tasksLoaded && activeKey) {
      const edgeUrl = `/api/tasks?key=${encodeURIComponent(activeKey)}`;
      const res = await fetch(edgeUrl, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data) {
          if (Array.isArray(data.courses)) {
            fetchedCourses = sanitizeCloudCourses(data.courses);
            fetchedCoursesUpdatedAt = data.coursesUpdatedAt || null;
          }
          if (data.ok && Array.isArray(data.tasks)) {
            fetchedTasks = sanitizeCloudTasks(data.tasks);
            fetchedSync = data.lastSync || new Date().toISOString();
            tasksLoaded = true;
            if (Array.isArray(data.quickLinks) && data.quickLinks.length > 0) {
              fetchedQuickLinks = sanitizeCloudQuickLinks(data.quickLinks);
            }
          }
        }
      }
    }

    // 3. Process courses if updated from cloud
    let coursesChanged = false;
    if (fetchedCourses && Array.isArray(fetchedCourses)) {
      fetchedCourses = filterCleanMobileCourses(fetchedCourses);
      const localCoursesUpdatedAt = state.coursesUpdatedAt || localStorage.getItem('bbs_mobile_courses_updated_at');
      const cloudTime = fetchedCoursesUpdatedAt ? new Date(fetchedCoursesUpdatedAt).getTime() : 0;
      const localTime = localCoursesUpdatedAt ? new Date(localCoursesUpdatedAt).getTime() : 0;

      // Only overwrite local courses if cloud timestamp is newer, or if local has no timestamp yet
      if (!localCoursesUpdatedAt || cloudTime > localTime) {
        const prevCoursesJson = JSON.stringify(state.userCourses || []);
        const newCoursesJson = JSON.stringify(fetchedCourses);
        if (prevCoursesJson !== newCoursesJson) {
          state.userCourses = fetchedCourses;
          state.coursesUpdatedAt = fetchedCoursesUpdatedAt;
          localStorage.setItem('bbs_mobile_courses', newCoursesJson);
          if (activeKey) {
            localStorage.setItem(`bbs_mobile_courses_${activeKey}`, newCoursesJson);
          }
          if (fetchedCoursesUpdatedAt) {
            localStorage.setItem('bbs_mobile_courses_updated_at', fetchedCoursesUpdatedAt);
          }
          recompileDynamicCourseData(state.userCourses);
          recalculateAllTaskWeightsAndRooms();
          initLegend();
          initScheduleAndSyllabus();
          renderGradeTracker();
          updateCourseDatalist();
          coursesChanged = true;
        } else if (fetchedCoursesUpdatedAt && fetchedCoursesUpdatedAt !== localCoursesUpdatedAt) {
          state.coursesUpdatedAt = fetchedCoursesUpdatedAt;
          localStorage.setItem('bbs_mobile_courses_updated_at', fetchedCoursesUpdatedAt);
        }
      }
    }

    if (!tasksLoaded && coursesChanged) {
      updateAllViews();
    }

    if (tasksLoaded) {
      const localMap = new Map((state.tasks || []).map(t => [t.id, t]));
      const tombstones = getLocalTombstones();
      let hasLocalModifications = false;

      const mergedTasks = [];
      const processedIds = new Set();

      for (const fbTask of fetchedTasks) {
        if (tombstones[fbTask.id]) {
          const tombTime = new Date(tombstones[fbTask.id]).getTime();
          const fbTime = new Date(fbTask.updatedAt || fbTask.createdAt || 0).getTime();
          if (tombTime >= fbTime) continue; // Deleted, skip resurrection
        }

        const localTask = localMap.get(fbTask.id);
        if (!localTask) {
          mergedTasks.push(fbTask);
          processedIds.add(fbTask.id);
        } else {
          processedIds.add(fbTask.id);
          const localTime = new Date(localTask.updatedAt || localTask.createdAt || 0).getTime();
          const fbTime = new Date(fbTask.updatedAt || fbTask.createdAt || 0).getTime();

          if (localTime > fbTime) {
            // Local edit is newer than server snapshot! Preserve local edit
            mergedTasks.push({
              ...fbTask,
              ...localTask
            });
            hasLocalModifications = true;
          } else {
            // Cloud task is newer or equal
            mergedTasks.push({
              ...localTask,
              ...fbTask,
              notes: fbTask.notes !== undefined ? fbTask.notes : localTask.notes,
              description: fbTask.description !== undefined ? fbTask.description : localTask.description,
              sourceSnippet: fbTask.sourceSnippet !== undefined ? fbTask.sourceSnippet : localTask.sourceSnippet,
              room: fbTask.room !== undefined ? fbTask.room : localTask.room,
              status: fbTask.status !== undefined ? fbTask.status : localTask.status,
              dueDate: fbTask.dueDate || localTask.dueDate,
              title: fbTask.title || localTask.title,
              courseName: fbTask.courseName || localTask.courseName,
              courseCode: fbTask.courseCode !== undefined ? fbTask.courseCode : localTask.courseCode
            });
          }
        }
      }

      // Retain any locally created tasks not yet in fetchedTasks (unless tombstoned)
      for (const [id, localTask] of localMap.entries()) {
        if (!processedIds.has(id)) {
          if (tombstones[id]) continue;
          mergedTasks.push(localTask);
          hasLocalModifications = true;
        }
      }

      let validatedTasks = deduplicateTaskList(mergedTasks.filter(isValidTask));
      validatedTasks.sort(compareTasksByTime);

      // Auto-backfill rooms, sanitize quotes, and syllabus weights if missing
      recalculateTaskList(validatedTasks);

      validatedTasks = deduplicateTaskList(validatedTasks);
      validatedTasks.sort(compareTasksByTime);

      // Diff check: only re-render the DOM if tasks or quick links actually changed!
      const prevTasksJson = JSON.stringify(state.tasks);
      const prevLinksJson = JSON.stringify(state.quickLinks);
      const tasksChanged = JSON.stringify(validatedTasks) !== prevTasksJson;
      const linksChanged = Boolean(fetchedQuickLinks && Array.isArray(fetchedQuickLinks) && fetchedQuickLinks.length > 0 && JSON.stringify(fetchedQuickLinks) !== prevLinksJson);

      let viewsNeedUpdate = coursesChanged;

      if (tasksChanged) {
        state.tasks = validatedTasks;
        localStorage.setItem('bbs_mobile_tasks', JSON.stringify(state.tasks));
        viewsNeedUpdate = true;
      }

      if (linksChanged && fetchedQuickLinks) {
        state.quickLinks = fetchedQuickLinks;
        localStorage.setItem('bbs_quick_links', JSON.stringify(state.quickLinks));
        renderQuickLinksBar();
        renderQuickLinksSchedule();
        renderQuickLinksManager();
      }

      if (fetchedSync && fetchedSync !== state.lastSync) {
        state.lastSync = fetchedSync;
        localStorage.setItem('bbs_mobile_last_sync', state.lastSync);
      }

      if (viewsNeedUpdate) {
        updateAllViews();
      }
      updateSyncBanner();

      // Check for newly announced upcoming deadlines
      const knownIdsRaw = localStorage.getItem('bbs_known_task_ids');
      if (knownIdsRaw) {
        try {
          const knownIds = new Set(JSON.parse(knownIdsRaw));
          const isPushEnabled = localStorage.getItem('bbs_push_enabled') === 'true' && Notification.permission === 'granted';
          if (isPushEnabled) {
            for (const t of state.tasks) {
              if (!knownIds.has(t.id) && t.status !== 'completed') {
                const dueMs = new Date(t.dueDate).getTime();
                if (dueMs > Date.now()) {
                  sendMobileNotification(`📢 New Deadline Added: ${t.title}`, {
                    body: `New ${t.type || 'task'} scheduled for ${t.courseCode || t.courseName}.`,
                    tag: `bbs-new-${t.id}`,
                    renotify: true,
                    data: { url: './index.html', taskId: t.id }
                  });
                }
              }
            }
          }
        } catch (e) {}
      }
      try {
        const currentIds = (state.tasks || []).map(t => t.id);
        localStorage.setItem('bbs_known_task_ids', JSON.stringify(currentIds));
      } catch (e) {}

      syncTasksToServiceWorker();
      checkUpcomingDeadlines(false);

      if (hasLocalModifications) {
        // Local additions or updates need to be saved back to Firebase Cloud
        syncToCloudAndLocal().catch(() => {});
      }

      if (isManual) {
        showToast('Synced with cloud: ' + state.tasks.length + ' deadlines up to date');
      }
    } else {
      throw new Error('No data returned from cloud endpoints');
    }
  } catch (err) {
    console.warn('Could not connect to sync cloud, using offline cache:', err);
    if (isManual) {
      showToast('Could not connect to cloud. Showing cached data.');
    } else if (!navigator.onLine && syncBanner) {
      syncBanner.textContent = state.tasks.length > 0 
        ? `Offline Mode: Showing ${state.tasks.length} cached deadlines` 
        : 'Offline: Waiting for connection...';
    }
  } finally {
    _isFetchingFromServer = false;
    if (isManual && refreshBtn) {
      setTimeout(() => {
        refreshBtn.querySelector('.refresh-icon')?.classList.remove('refresh-spinning');
      }, 400);
    }
  }
}

/**
 * True bidirectional sync:
 * 1. Flushes pending offline mutations
 * 2. Fetches freshest tasks from cloud and reconciles
 * 3. Pushes reconciled state back to cloud so both sides are identical
 */
async function syncBidirectionally(isManual = false) {
  const refreshBtn = document.getElementById('btn-refresh');
  const syncBanner = document.getElementById('sync-banner-text');

  if (isManual) {
    refreshBtn?.querySelector('.refresh-icon')?.classList.add('refresh-spinning');
    if (syncBanner) syncBanner.textContent = 'Syncing deadlines with Firebase Cloud...';
  }

  try {
    // 1. Flush any pending offline mutations first
    await flushOfflineMutations();

    // 2. Fetch latest tasks from cloud & reconcile (passing isManual flag)
    await fetchTasksFromServer(isManual);

    // 3. Push full reconciled state to cloud so both laptop and phone are in lockstep
    await syncToCloudAndLocal(true);

    if (isManual) {
      showToast(`Synced with cloud: ${state.tasks.length} deadlines up to date`);
    }
  } catch (err) {
    console.warn('Bidirectional sync failed:', err);
    if (isManual) {
      showToast('Sync error: ' + (err.message || 'offline'));
    }
  } finally {
    if (isManual && refreshBtn) {
      refreshBtn.querySelector('.refresh-icon')?.classList.remove('refresh-spinning');
    }
    updateSyncBanner();
  }
}

function updateSyncBanner() {
  const syncBanner = document.getElementById('sync-banner-text');
  const metricLastSync = document.getElementById('metric-last-sync');
  if (!syncBanner) return;

  if (!state.lastSync) {
    syncBanner.textContent = 'No sync record yet';
    if (metricLastSync) metricLastSync.textContent = 'Never';
    return;
  }

  const syncDate = new Date(state.lastSync);
  const timeStr = syncDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = syncDate.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const count = state.tasks.length;
  const countStr = count === 1 ? '1 deadline' : `${count} deadlines`;
  const display = `Updated ${dateStr}, ${timeStr} · ${countStr}`;

  syncBanner.textContent = display;
  if (metricLastSync) metricLastSync.textContent = `${dateStr} at ${timeStr}`;
}

function updateAllViews() {
  renderCalendar();
  renderSelectedDay(state.selectedDate);
  renderUpNextAgenda();
  renderDeadlines();
  renderQuickLinksBar();
  renderQuickLinksSchedule();
  updateStats();
  updateBadgeCounts();
  populateCourseFilter();
  renderGradeTracker();

  // If day sheet drawer is currently open, refresh its items to reflect status changes immediately
  const drawer = document.getElementById('day-sheet-drawer');
  if (drawer && drawer.style.display !== 'none' && !drawer.classList.contains('hidden') && state.selectedDate) {
    const dayTasks = state.tasks.filter(t => {
      if (!t.dueDate || localDateKey(t.dueDate) !== state.selectedDate) return false;
      if (!matchesSelectedCourseFilter(t, state.selectedCourseFilter)) return false;
      return true;
    });
    const itemsContainer = document.getElementById('day-sheet-items');
    const count = document.getElementById('day-sheet-count');
    if (itemsContainer) {
      const sorted = dayTasks.slice().sort(compareTasksByTime);
      if (count) {
        count.textContent = sorted.length === 1 ? '1 Deadline Scheduled' : `${sorted.length} Deadlines Scheduled`;
      }
      if (sorted.length === 0) {
        itemsContainer.innerHTML = `
          <div class="state-container">
            <div class="state-icon">${getSvgIcon('coffee')}</div>
            <div class="state-title">No Deadlines for this Day</div>
            <div class="state-desc">You are completely free on this date. Take time to relax or review class material!</div>
          </div>
        `;
      } else {
        itemsContainer.innerHTML = sorted.map(t => renderTaskCardHtml(t, false)).join('');
        bindTaskCardEvents(itemsContainer);
      }
    }
  }
}

// Wi-Fi Connection State Listeners
function initOnlineListeners() {
  const wifiBadge = document.getElementById('wifi-status-badge');
  const wifiText = document.getElementById('wifi-status-text');
  const metricNet = document.getElementById('metric-network-status');

  function updateStatus(isOnline) {
    if (isOnline) {
      if (wifiBadge) {
        wifiBadge.className = 'wifi-status-badge online';
      }
      if (wifiText) wifiText.textContent = 'Online';
      if (metricNet) metricNet.textContent = 'Connected (Wi-Fi)';
      // Replay offline mutations to Firebase/server, then fetch freshest
      flushOfflineMutations().then(() => fetchTasksFromServer());
    } else {
      if (wifiBadge) {
        wifiBadge.className = 'wifi-status-badge offline';
      }
      if (wifiText) wifiText.textContent = 'Offline';
      if (metricNet) metricNet.textContent = 'Offline (Cached Mode)';
      showToast('You are offline. Showing cached deadlines.');
    }
  }

  window.addEventListener('online', () => {
    updateStatus(true);
    flushOfflineMutations();
  });
  window.addEventListener('offline', () => updateStatus(false));
  window.addEventListener('focus', () => {
    checkUpcomingDeadlines(false);
    if (navigator.onLine) {
      flushOfflineMutations().then(() => fetchTasksFromServer());
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkUpcomingDeadlines(false);
      if (navigator.onLine) {
        fetchTasksFromServer();
      }
    }
  });

  // Scheduled check every 60 seconds for imminent deadlines
  setInterval(() => {
    checkUpcomingDeadlines(false);
  }, 60000);

  // Heartbeat poll every 10 seconds while tab is active so extension changes mirror immediately
  setInterval(() => {
    if (document.visibilityState === 'visible' && navigator.onLine) {
      fetchTasksFromServer();
    }
  }, 10000);

  // Sync with Chrome extension or other tabs via BroadcastChannel
  try {
    const syncChannel = new BroadcastChannel('bbs_sync_channel');
    syncChannel.onmessage = (event) => {
      if (event.data?.type === 'TASKS_UPDATED' || event.data?.type === 'COURSES_UPDATED') {
        fetchTasksFromServer();
      }
    };
  } catch (e) {}

  window.addEventListener('storage', (e) => {
    if (e.key === 'bbs_mobile_courses') {
      const updated = loadInitialUserCourses();
      state.userCourses = updated;
      recompileDynamicCourseData(state.userCourses);
      recalculateAllTaskWeightsAndRooms();
      initLegend();
      initScheduleAndSyllabus();
      renderGradeTracker();
      updateCourseDatalist();
      updateAllViews();
    } else if (e.key === 'bbs_mobile_tasks' || e.key === 'bbs_sync_key') {
      loadCachedTasks();
      updateAllViews();
    }
  });

  document.getElementById('btn-refresh')?.addEventListener('click', () => syncBidirectionally(true));
  document.getElementById('btn-force-refresh')?.addEventListener('click', async () => {
    showToast('Checking for application updates and synchronizing cloud...', 2000);
    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) await reg.update();
      } catch (e) {}
    }
    await syncBidirectionally(true);
  });
}

// ==========================================================================
// VIEW 1: Calendar Rendering
// ==========================================================================
function initCalendar() {
  document.getElementById('btn-prev-month')?.addEventListener('click', () => {
    navigateMonth(-1);
  });

  document.getElementById('btn-next-month')?.addEventListener('click', () => {
    navigateMonth(1);
  });

  document.getElementById('btn-today')?.addEventListener('click', () => {
    state.displayedMonth = new Date();
    renderCalendar();
  });

  initCalendarSwipe();
}

function navigateMonth(delta) {
  const grid = document.getElementById('calendar-grid');
  if (grid) {
    grid.style.transition = 'opacity 0.12s ease, transform 0.12s ease';
    grid.style.opacity = '0';
    grid.style.transform = delta > 0 ? 'translateX(-12px)' : 'translateX(12px)';
    setTimeout(() => {
      state.displayedMonth.setMonth(state.displayedMonth.getMonth() + delta);
      renderCalendar();
      grid.style.transform = delta > 0 ? 'translateX(12px)' : 'translateX(-12px)';
      requestAnimationFrame(() => {
        grid.style.opacity = '1';
        grid.style.transform = 'translateX(0)';
        setTimeout(() => {
          grid.style.transition = '';
          grid.style.transform = '';
        }, 130);
      });
    }, 120);
  } else {
    state.displayedMonth.setMonth(state.displayedMonth.getMonth() + delta);
    renderCalendar();
  }
}

function initCalendarSwipe() {
  const grid = document.getElementById('calendar-grid');
  if (!grid) return;

  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let isSwiping = false;

  grid.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    startTime = Date.now();
    isSwiping = true;
  }, { passive: true });

  grid.addEventListener('touchend', (e) => {
    if (!isSwiping || e.changedTouches.length !== 1) return;
    isSwiping = false;

    const diffX = e.changedTouches[0].clientX - startX;
    const diffY = e.changedTouches[0].clientY - startY;
    const elapsed = Date.now() - startTime;

    // Must be quick (< 600ms), horizontal (|diffX| > 45px), and primarily horizontal (|diffX| > 1.3 * |diffY|)
    if (elapsed < 600 && Math.abs(diffX) > 45 && Math.abs(diffX) > Math.abs(diffY) * 1.3) {
      if (diffX < 0) {
        // Swiped Left -> Next Month
        navigateMonth(1);
      } else {
        // Swiped Right -> Previous Month
        navigateMonth(-1);
      }
    }
  }, { passive: true });
}

function initLegend() {
  const container = document.getElementById('calendar-legend-items');
  if (!container) return;
  const panel = container.closest('.course-legend-panel');

  if (PERMANENT_COURSE_LEGEND.length === 0) {
    container.innerHTML = '';
    if (panel) panel.style.display = 'none';
    return;
  }
  if (panel) panel.style.display = '';

  const isAllActive = state.selectedCourseFilter === null;
  const hasActiveFilter = !isAllActive;

  if (hasActiveFilter) {
    container.classList.add('has-active-filter');
  } else {
    container.classList.remove('has-active-filter');
  }

  let html = `
    <span class="legend-chip ${isAllActive ? 'is-active' : ''}" data-course="">
      <span>All</span>
    </span>
  `;

  html += PERMANENT_COURSE_LEGEND.map(c => {
    const isActive = state.selectedCourseFilter === c.name;
    return `
      <span class="legend-chip ${isActive ? 'is-active' : ''}" data-course="${escapeHtml(c.name)}">
        <span class="legend-color-box" style="background-color: ${c.color};"></span>
        <span>${escapeHtml(c.name)}</span>
      </span>
    `;
  }).join('');

  container.innerHTML = html;

  container.querySelectorAll('.legend-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const course = chip.getAttribute('data-course');
      if (!course) {
        state.selectedCourseFilter = null;
      } else if (state.selectedCourseFilter === course) {
        state.selectedCourseFilter = null;
      } else {
        state.selectedCourseFilter = course;
      }
      initLegend();
      renderCalendar();
      renderSelectedDay();
      renderUpNextAgenda();
    });
  });
}

function renderCalendar() {
  const heading = document.getElementById('cal-month-heading');
  const grid = document.getElementById('calendar-grid');
  if (!heading || !grid) return;

  const year = state.displayedMonth.getFullYear();
  const month = state.displayedMonth.getMonth();

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  heading.textContent = `${monthNames[month]} ${year}`;

  grid.innerHTML = '';

  const firstDayIndex = new Date(year, month, 1).getDay(); // 0 = Sun, 1 = Mon ...
  const offset = (firstDayIndex + 6) % 7; // Monday = 0, Sunday = 6
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const today = new Date();
  const isCurrentYearMonth = today.getFullYear() === year && today.getMonth() === month;

  function renderDayCell(dayNum, dateStr, isOtherMonth, isToday) {
    const cell = document.createElement('div');
    cell.className = `cal-day-cell ${isOtherMonth ? 'other-month' : ''} ${isToday ? 'is-today' : ''}`.trim();

    // Find tasks for this day
    const dayTasks = state.tasks.filter(t => {
      if (!t.dueDate) return false;
      if (localDateKey(t.dueDate) !== dateStr) return false;
      if (!matchesSelectedCourseFilter(t, state.selectedCourseFilter)) return false;
      return true;
    });
    dayTasks.sort(compareTasksByTime);

    let chipsHtml = '';
    if (dayTasks.length > 0) {
      chipsHtml = '<div class="cal-event-chips-container">';
      const maxChips = 2;
      const displayChips = dayTasks.slice(0, maxChips);
      const overflowCount = dayTasks.length - maxChips;

      displayChips.forEach(task => {
        const { courseName, courseCode } = resolveCourseInfo(task);
        const color = getCourseColor(courseCode, courseName, task.title);
        const isDone = task.status === 'completed';
        const safeTitle = escapeHtml(task.title);
        const tooltip = escapeHtml(`${isDone ? '[Completed] ' : ''}[${courseName}] ${task.title}`);
        const iconSvg = isDone ? getSvgIcon('check', 'chip-svg-icon') : getTaskTypeIcon(task.type, 'chip-svg-icon');
        const styleAttr = isDone ? `style="border-color: ${color}; border-left-color: ${color};"` : `style="background-color: ${color};"`;
        chipsHtml += `<span class="cal-event-chip ${isDone ? 'is-completed' : ''}" ${styleAttr} title="${tooltip}">` +
          `<span class="chip-icon">${iconSvg}</span>` +
          `<span class="chip-text">${safeTitle}</span>` +
        `</span>`;
      });

      if (overflowCount > 0) {
        chipsHtml += `<span class="cal-event-more">+${overflowCount}</span>`;
      }
      chipsHtml += '</div>';
    }

    cell.setAttribute('data-date', dateStr);
    cell.innerHTML = `
      <span class="day-number">${dayNum}</span>
      ${chipsHtml}
    `;

    // Click handler to select day and open Day Drawer on mobile screens
    cell.addEventListener('click', () => {
      document.querySelectorAll('.cal-day-cell').forEach(c => c.classList.remove('is-selected'));
      cell.classList.add('is-selected');
      state.selectedDate = dateStr;
      renderSelectedDay(dateStr, dayTasks);
      // Phones and the wide dashboard have no inline day panel, so they open the day sheet
      if (window.innerWidth <= 640 || isDashboardLayout()) {
        openDaySheet(dateStr, dayTasks);
      }
    });

    return cell;
  }

  // 1. Previous month trailing days (now display tasks and open day sheet)
  for (let i = offset - 1; i >= 0; i--) {
    const dayNum = daysInPrevMonth - i;
    const prevDate = new Date(year, month - 1, dayNum);
    const pYear = prevDate.getFullYear();
    const pMonth = String(prevDate.getMonth() + 1).padStart(2, '0');
    const pDay = String(dayNum).padStart(2, '0');
    const dateStr = `${pYear}-${pMonth}-${pDay}`;
    grid.appendChild(renderDayCell(dayNum, dateStr, true, false));
  }

  // 2. Current month days
  for (let day = 1; day <= daysInMonth; day++) {
    const isToday = isCurrentYearMonth && today.getDate() === day;
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    grid.appendChild(renderDayCell(day, dateStr, false, isToday));
  }

  // 3. Next month leading days to complete 7-column grid (now display tasks and open day sheet)
  const totalCells = offset + daysInMonth;
  const remainingCells = (7 - (totalCells % 7)) % 7;
  for (let d = 1; d <= remainingCells; d++) {
    const nextDate = new Date(year, month + 1, d);
    const nYear = nextDate.getFullYear();
    const nMonth = String(nextDate.getMonth() + 1).padStart(2, '0');
    const nDay = String(d).padStart(2, '0');
    const dateStr = `${nYear}-${nMonth}-${nDay}`;
    grid.appendChild(renderDayCell(d, dateStr, true, false));
  }

  // Default selected date if unset
  if (!state.selectedDate) {
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    state.selectedDate = todayStr;
  }

  // Highlight active day in current grid
  const activeCell = grid.querySelector(`.cal-day-cell[data-date="${state.selectedDate}"]`);
  if (activeCell) {
    activeCell.classList.add('is-selected');
  }
}

// ==========================================================================
// Day Sheet Drawer
// ==========================================================================
function closeDaySheet() {
  const backdrop = document.getElementById('day-sheet-backdrop');
  const drawer = document.getElementById('day-sheet-drawer');
  if (backdrop) {
    backdrop.classList.add('hidden');
    backdrop.style.display = 'none';
  }
  if (drawer) {
    drawer.classList.add('hidden');
    drawer.style.display = 'none';
  }
}
window.closeDaySheet = closeDaySheet;

function initDaySheet() {
  const backdrop = document.getElementById('day-sheet-backdrop');
  const closeBtn = document.getElementById('btn-close-day-sheet');

  if (backdrop) backdrop.addEventListener('click', closeDaySheet);
  if (closeBtn) closeBtn.addEventListener('click', closeDaySheet);
}

function openDaySheet(dateStr, dayTasks) {
  const backdrop = document.getElementById('day-sheet-backdrop');
  const drawer = document.getElementById('day-sheet-drawer');
  const title = document.getElementById('day-sheet-title');
  const count = document.getElementById('day-sheet-count');
  const itemsContainer = document.getElementById('day-sheet-items');

  if (!drawer || !backdrop || !itemsContainer) return;

  const sortedDayTasks = (dayTasks || []).slice().sort(compareTasksByTime);

  const dateObj = new Date(`${dateStr}T00:00:00`);
  const options = { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' };
  title.textContent = dateObj.toLocaleDateString([], options);
  count.textContent = sortedDayTasks.length === 1 ? '1 Deadline Scheduled' : `${sortedDayTasks.length} Deadlines Scheduled`;

  if (sortedDayTasks.length === 0) {
    itemsContainer.innerHTML = `
      <div class="state-container">
        <div class="state-icon">${getSvgIcon('coffee')}</div>
        <div class="state-title">No Deadlines for this Day</div>
        <div class="state-desc">You are completely free on this date. Take time to relax or review class material!</div>
      </div>
    `;
  } else {
    itemsContainer.innerHTML = sortedDayTasks.map(task => renderTaskCardHtml(task, false)).join('');
    bindTaskCardEvents(itemsContainer);
  }

  const dayAddBtn = document.getElementById('btn-day-add-deadline');
  if (dayAddBtn) {
    dayAddBtn.onclick = () => {
      openAddTaskModal(dateStr);
    };
  }

  backdrop.style.display = 'block';
  drawer.style.display = 'flex';
  backdrop.classList.remove('hidden');
  drawer.classList.remove('hidden');
}

// ==========================================================================
// Selected Day Container (Inline under Calendar)
// ==========================================================================
function renderSelectedDay(dateStr = null, dayTasks = null) {
  const container = document.getElementById('selected-day-container');
  const titleText = document.getElementById('selected-day-title-text');
  const list = document.getElementById('selected-day-list');
  if (!container || !list) return;

  const targetDate = dateStr || state.selectedDate || localDateKey(new Date());
  const [y, m, d] = targetDate.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  const formattedHeader = dateObj.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });

  if (titleText) {
    titleText.textContent = `Deadlines for ${formattedHeader}`;
  }

  const tasksOnDate = (dayTasks || state.tasks.filter(t => t.dueDate && localDateKey(t.dueDate) === targetDate))
    .filter(t => matchesSelectedCourseFilter(t, state.selectedCourseFilter));
  tasksOnDate.sort(compareTasksByTime);

  list.innerHTML = '';

  if (tasksOnDate.length === 0) {
    list.innerHTML = `
      <div class="selected-day-empty">
        <span>No deadlines scheduled for this day.</span>
      </div>
    `;
    return;
  }

  tasksOnDate.forEach(task => {
    const { courseName, courseCode } = resolveCourseInfo(task);
    const color = getCourseColor(courseCode, courseName, task.title);
    const isCompleted = task.status === 'completed';

    let timeDisplay = 'Class Time';
    if (task.hasSpecificTime && task.dueDate) {
      const dt = new Date(task.dueDate);
      if (!isNaN(dt.getTime())) {
        timeDisplay = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
    }

    const weightHtml = task.weightDisplay ? `
      <span class="selected-day-weight" title="${escapeHtml(task.syllabusNote || 'Syllabus weight')}">
        ${getSvgIcon('scale', 'mr-1')} ${escapeHtml(task.weightDisplay)}
      </span>
    ` : '';

    const item = document.createElement('div');
    item.className = `selected-day-item ${isCompleted ? 'status-completed' : ''}`;
    item.style.borderLeft = `4px solid ${color}`;
    item.style.setProperty('border-left-color', color, 'important');
    item.setAttribute('data-id', task.id);

    const isHwOrProj = task.type === 'assignment' || task.type === 'hw' || task.type === 'project';

    item.innerHTML = `
      <div class="selected-day-info">
        <div class="selected-day-course" style="color: ${color};">${escapeHtml(courseName)}</div>
        <div class="selected-day-item-title">${escapeHtml(task.title)}</div>
        <div class="selected-day-meta-row">
          <span class="selected-day-time">${getSvgIcon('clock', 'mr-1')} ${escapeHtml(timeDisplay)}</span>
          ${(!isHwOrProj && task.room) ? `<span class="selected-day-room">${getSvgIcon('pin', 'mr-1')} ${escapeHtml(task.room)}</span>` : ''}
          ${weightHtml}
        </div>
      </div>
      <div class="selected-day-actions">
        <button type="button" class="btn-sel-action btn-sel-toggle" title="${isCompleted ? 'Mark as Pending' : 'Mark as Done'}" data-id="${escapeHtml(task.id)}">
          ${isCompleted ? getSvgIcon('check') : getSvgIcon('circle')}
        </button>
        <button type="button" class="btn-sel-action btn-sel-edit" title="Edit Deadline" data-id="${escapeHtml(task.id)}">
          ${getSvgIcon('pencil')}
        </button>
      </div>
    `;

    // Click item body to open full reading sheet
    item.querySelector('.selected-day-info')?.addEventListener('click', () => {
      openReadingSheet(task);
    });

    // Toggle status with 5s undo toast
    item.querySelector('.btn-sel-toggle')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const prevStatus = task.status;
      const newStatus = prevStatus === 'completed' ? 'pending' : 'completed';
      task.status = newStatus;
      task.updatedAt = new Date().toISOString();

      showToast(
        newStatus === 'completed' ? 'Marked as completed' : 'Reverted to pending',
        'Undo',
        async () => {
          task.status = prevStatus;
          task.updatedAt = new Date().toISOString();
          enqueueOfflineMutation({ type: 'status', taskId: task.id, status: prevStatus });
          syncToCloudAndLocal();
          showToast('Status reverted');
        }
      );

      enqueueOfflineMutation({ type: 'status', taskId: task.id, status: newStatus });
      syncToCloudAndLocal();
    });

    // Edit deadline
    item.querySelector('.btn-sel-edit')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openEditTaskModal(task);
    });

    list.appendChild(item);
  });
}

function initSelectedDayContainer() {
  document.getElementById('btn-add-on-date')?.addEventListener('click', () => {
    openAddTaskModal(state.selectedDate || localDateKey(new Date()));
  });

  document.getElementById('btn-open-day-sheet')?.addEventListener('click', () => {
    const activeDate = state.selectedDate || localDateKey(new Date());
    const dayTasks = state.tasks.filter(t => t.dueDate && localDateKey(t.dueDate) === activeDate);
    openDaySheet(activeDate, dayTasks);
  });
}

// ==========================================================================
// Up Next Agenda (Compact Mobile-First Agenda Card Below Calendar)
// ==========================================================================
function getRelativeTimeBadge(dueDateIso) {
  if (!dueDateIso) return { text: 'Pending', cls: 'badge-future' };
  const due = new Date(dueDateIso);
  if (isNaN(due.getTime())) return { text: 'Pending', cls: 'badge-future' };

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dueStart = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
  const diffDays = Math.round((dueStart - todayStart) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return { text: 'Overdue', cls: 'badge-overdue' };
  } else if (diffDays === 0) {
    return { text: 'Today', cls: 'badge-today' };
  } else if (diffDays === 1) {
    return { text: 'Tomorrow', cls: 'badge-tomorrow' };
  } else {
    return { text: `In ${diffDays}d`, cls: 'badge-future' };
  }
}

function formatUpNextDateTime(task) {
  if (!task.dueDate) return 'No due date';
  const d = new Date(task.dueDate);
  if (isNaN(d.getTime())) return 'No due date';
  const dateStr = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  if (task.hasSpecificTime === false) {
    return `${dateStr} \u2022 Class Time`;
  }
  const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${dateStr} \u2022 ${timeStr}`;
}

function renderUpNextAgenda() {
  const container = document.getElementById('up-next-container');
  const list = document.getElementById('up-next-list');
  const countBadge = document.getElementById('up-next-count-badge');
  if (!container || !list) return;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  // Filter uncompleted tasks respecting course filter from today onward
  const uncompleted = (state.tasks || []).filter(task => {
    if (task.status === 'completed') return false;
    if (!task.dueDate) return false;
    if (!matchesSelectedCourseFilter(task, state.selectedCourseFilter)) return false;
    const taskTime = getTaskSortTimestamp(task);
    return taskTime >= todayStart;
  });

  uncompleted.sort(compareTasksByTime);
  const upNext = uncompleted.slice(0, 3);

  if (countBadge) {
    if (uncompleted.length === 0) {
      countBadge.textContent = 'Caught up';
    } else {
      countBadge.textContent = `${uncompleted.length} upcoming`;
    }
  }

  if (upNext.length === 0) {
    list.innerHTML = `
      <div class="up-next-empty">
        <svg class="ui-icon" style="color: var(--success);"><use href="#icon-check"></use></svg>
        <span>All caught up! No upcoming deadlines.</span>
      </div>
    `;
    return;
  }

  list.innerHTML = upNext.map(task => {
    const { courseName, courseCode } = resolveCourseInfo(task);
    const courseTheme = getCourseColorTheme(courseName, courseCode, task.title);
    const badgeInfo = getRelativeTimeBadge(task.dueDate);
    const dateTimeStr = formatUpNextDateTime(task);
    const hasRoom = Boolean(task.room && task.room.trim());

    return `
      <div class="up-next-item" data-task-id="${escapeHtml(task.id)}">
        <button type="button" class="up-next-checkbox" data-task-id="${escapeHtml(task.id)}" aria-label="Mark completed" title="Mark as completed">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><use href="#icon-check"></use></svg>
        </button>
        <div class="up-next-item-main">
          <div class="up-next-item-top">
            <span class="up-next-course-chip" style="background: ${courseTheme.bgLight}; color: ${courseTheme.textDark}; border: 1px solid ${courseTheme.border};">
              <span class="up-next-course-dot" style="background: ${courseTheme.hex};"></span>
              <span class="up-next-course-name">${escapeHtml(courseName)}</span>
            </span>
            <span class="up-next-badge ${badgeInfo.cls}">${badgeInfo.text}</span>
          </div>
          <div class="up-next-item-title">${escapeHtml(task.title)}</div>
          <div class="up-next-item-time">
            <svg class="ui-icon mr-1"><use href="#icon-clock"></use></svg>
            <span>${dateTimeStr}</span>
            ${hasRoom ? `<span class="up-next-room-tag"><svg class="ui-icon mr-1"><use href="#icon-pin"></use></svg>${escapeHtml(task.room.trim())}</span>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');

  list.querySelectorAll('.up-next-item').forEach(item => {
    const taskId = item.getAttribute('data-task-id');
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    item.addEventListener('click', (e) => {
      if (e.target.closest('.up-next-checkbox')) return;
      openReadingSheet(task);
    });

    const checkbox = item.querySelector('.up-next-checkbox');
    if (checkbox) {
      checkbox.addEventListener('click', async (e) => {
        e.stopPropagation();
        checkbox.classList.add('is-checked');
        item.style.opacity = '0.45';
        item.style.transform = 'scale(0.98)';
        item.style.transition = 'all 0.16s ease';

        const prevStatus = task.status;
        const newStatus = 'completed';
        task.status = newStatus;
        task.updatedAt = new Date().toISOString();

        showToast(
          'Marked as completed',
          'Undo',
          async () => {
            task.status = prevStatus;
            task.updatedAt = new Date().toISOString();
            enqueueOfflineMutation({ type: 'status', taskId: task.id, status: prevStatus });
            syncToCloudAndLocal();
            showToast('Status reverted');
          }
        );

        enqueueOfflineMutation({ type: 'status', taskId: task.id, status: newStatus });
        syncToCloudAndLocal();
      });
    }
  });
}

// ==========================================================================
// VIEW 2: Deadlines List & Search
// ==========================================================================
function initDeadlinesControls() {
  const searchInput = document.getElementById('input-search');
  const filterChips = document.querySelectorAll('.filter-chip');
  const courseSelect = document.getElementById('select-course-filter');
  const typeSelect = document.getElementById('select-type-filter');

  searchInput?.addEventListener('input', e => {
    state.searchQuery = e.target.value.toLowerCase().trim();
    renderDeadlines();
  });

  filterChips.forEach(chip => {
    chip.addEventListener('click', () => {
      filterChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      state.filterStatus = chip.getAttribute('data-filter');
      renderDeadlines();
    });
  });

  courseSelect?.addEventListener('change', e => {
    state.filterCourse = e.target.value;
    renderDeadlines();
  });

  typeSelect?.addEventListener('change', e => {
    state.filterType = e.target.value;
    renderDeadlines();
  });
}

function populateCourseFilter() {
  const select = document.getElementById('select-course-filter');
  if (!select) return;

  const currentVal = select.value;
  const coursesMap = new Map();

  state.tasks.forEach(t => {
    const { courseName, courseCode } = resolveCourseInfo(t);
    const key = courseCode || courseName;
    if (key && !coursesMap.has(key)) {
      const label = courseCode && courseCode !== courseName ? `${courseName} (${courseCode})` : courseName;
      coursesMap.set(key, label);
    }
  });

  let optionsHtml = '<option value="all">All Courses</option>';
  coursesMap.forEach((label, key) => {
    optionsHtml += `<option value="${escapeHtml(key)}" ${key === currentVal ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  });

  select.innerHTML = optionsHtml;
}

function renderDeadlines() {
  const container = document.getElementById('deadlines-container');
  if (!container) return;

  // Filter tasks
  const filtered = state.tasks.filter(task => {
    // 1. Status Filter
    if (state.filterStatus !== 'all' && task.status !== state.filterStatus) {
      return false;
    }

    // 2. Course Filter
    if (state.filterCourse !== 'all') {
      const { courseName, courseCode } = resolveCourseInfo(task);
      const match = (task.courseCode === state.filterCourse) || 
                    (task.courseName === state.filterCourse) ||
                    (courseCode === state.filterCourse) ||
                    (courseName === state.filterCourse);
      if (!match) return false;
    }

    // 3. Type Filter
    if (state.filterType !== 'all' && task.type !== state.filterType) {
      return false;
    }

    // 4. Search Filter
    if (state.searchQuery) {
      const matchTitle = (task.title || '').toLowerCase().includes(state.searchQuery);
      const matchCourse = (task.courseName || '').toLowerCase().includes(state.searchQuery) ||
                          (task.courseCode || '').toLowerCase().includes(state.searchQuery);
      const matchSnippet = (task.sourceSnippet || task.description || '').toLowerCase().includes(state.searchQuery);
      if (!matchTitle && !matchCourse && !matchSnippet) return false;
    }

    return true;
  });

  // Sort: pending first, sorted by due date ascending (earliest first)
  filtered.sort((a, b) => {
    if (a.status === 'pending' && b.status !== 'pending') return -1;
    if (a.status !== 'pending' && b.status === 'pending') return 1;
    return compareTasksByTime(a, b);
  });

  // Keep selectedTaskId synced
  if (filtered.length > 0) {
    if (!state.selectedTaskId || !filtered.some(t => t.id === state.selectedTaskId)) {
      state.selectedTaskId = filtered[0].id;
    }
  } else {
    state.selectedTaskId = null;
  }

  if (filtered.length === 0) {
    if (state.tasks.length === 0) {
      const hasKey = Boolean(getSyncKey());
      container.innerHTML = `
        <div class="state-container">
          <div class="state-icon">${getSvgIcon('bolt')}</div>
          <div class="state-title">${hasKey ? 'No Deadlines Found Yet' : 'Connect Your Blackboarder Extension'}</div>
          <div class="state-desc">
            ${hasKey
              ? 'Open Blackboard on your laptop and click "Scan Blackboard" to synchronize your courses here.'
              : 'Open the Blackboarder extension on your laptop, click Settings &gt; "Copy Phone Pairing Link", and open it here to connect your deadlines.'}
          </div>
          <div style="margin-top: 14px;">
            <button type="button" class="btn-primary-action btn-trigger-setup" style="padding: 9px 18px; font-size: 13px; display: inline-flex; align-items: center; gap: 6px; width: auto; margin: 0 auto;">
              ${getSvgIcon('bolt')}
              <span>Open Setup Guide</span>
            </button>
          </div>
        </div>
      `;
      container.querySelector('.btn-trigger-setup')?.addEventListener('click', () => {
        openOnboardingModal(1);
      });
    } else {
      container.innerHTML = `
        <div class="state-container">
          <div class="state-icon">${getSvgIcon('search')}</div>
          <div class="state-title">No Matching Deadlines</div>
          <div class="state-desc">Try clearing your search query or switching your filter tabs.</div>
        </div>
      `;
    }
    renderReadingPane(null);
    return;
  }

  container.innerHTML = filtered.map(task => renderTaskCardHtml(task, false)).join('');
  bindTaskCardEvents(container);

  const selectedTask = state.tasks.find(t => t.id === state.selectedTaskId) || filtered[0];
  renderReadingPane(selectedTask);
}

function renderTaskCardHtml(task, isCompact = false) {
  const { courseName, courseCode } = resolveCourseInfo(task);
  const courseTheme = getCourseColorTheme(courseName, courseCode, task.title);
  const isCompleted = task.status === 'completed';
  const countdown = formatCountdown(task.dueDate, task.hasSpecificTime, task.status);
  const typeIcon = getTaskTypeIcon(task.type);
  const typeLabel = (task.type || 'assignment').toUpperCase();

  // Room pill button (1-click room changer - only if not hw or project)
  const isHwOrProj = task.type === 'assignment' || task.type === 'hw' || task.type === 'project';
  let roomBadgeHtml = '';
  if (!isHwOrProj) {
    if (task.room) {
      roomBadgeHtml = `
        <button type="button" class="room-pill-btn" data-task-id="${escapeHtml(task.id)}" title="Click to change room">
          <span>${getSvgIcon('pin', 'mr-1')} ${escapeHtml(task.room)}</span>
          <span class="room-edit-hint">${getSvgIcon('pencil')}</span>
        </button>
      `;
    } else {
      roomBadgeHtml = `
        <button type="button" class="room-pill-btn" data-task-id="${escapeHtml(task.id)}" style="background:#f1f5f9; color:#64748b; border-color:#e2e8f0;" title="Click to assign room">
          <span>${getSvgIcon('pin', 'mr-1')} Add Room</span>
          <span class="room-edit-hint">${getSvgIcon('plus')}</span>
        </button>
      `;
    }
  }

  // Weight badge
  let weightBadgeHtml = '';
  if (task.weightDisplay || task.weight) {
    const weightVal = task.weight || 0;
    const isMajor = weightVal >= 20;
    const isMedium = weightVal >= 10 && weightVal < 20;
    const weightClass = isMajor ? 'weight-major' : (isMedium ? 'weight-medium' : '');
    const displayText = task.weightDisplay || `${task.weight}% of Grade`;
    weightBadgeHtml = `<span class="task-weight-pill ${weightClass}" title="${task.syllabusNote ? escapeHtml(task.syllabusNote) : 'Syllabus weight'}">${getSvgIcon('scale', 'mr-1')} ${escapeHtml(displayText)}</span>`;
  }

  // Class Time Indicator
  let classTimeBadgeHtml = '';
  if (!task.hasSpecificTime) {
    classTimeBadgeHtml = `<span class="meta-pill time-class">${getSvgIcon('clock', 'mr-1')} Class Time</span>`;
  }

  // Clean Doctor's announcement quote with expand/collapse toggle
  let doctorQuoteHtml = '';
  const snippet = (task.description || task.sourceSnippet || '').trim();
  if (snippet && !snippet.startsWith('Blackboard Ultra Stream item') && !isCompact) {
    const isLong = snippet.length > 120 || snippet.includes('\n');
    doctorQuoteHtml = `
      <div class="doctor-quote-box">
        <div class="quote-label-row">
          <div class="quote-label">
            <span>${getSvgIcon('message', 'mr-1')}</span>
            <span>Doctor Announcement:</span>
          </div>
          <button type="button" class="btn-inspect-quote" data-task-id="${escapeHtml(task.id)}" title="Inspect full announcement">
            <span>${getSvgIcon('search', 'mr-1')} Full View</span>
          </button>
        </div>
        <div class="quote-body ${isLong ? 'clamped' : 'expanded'}" id="quote-body-${escapeHtml(task.id)}">${escapeHtml(snippet)}</div>
        ${isLong ? `
          <button type="button" class="btn-toggle-quote" data-task-id="${escapeHtml(task.id)}" aria-expanded="false">
            <span class="quote-toggle-icon">${getSvgIcon('book', 'mr-1')}</span>
            <span class="quote-toggle-text">Read Full Announcement ▾</span>
          </button>
        ` : ''}
      </div>
    `;
  }

  // Student Personal Notes
  let studentNotesHtml = '';
  if (task.notes && task.notes.trim() && !isCompact) {
    studentNotesHtml = `
      <div class="student-notes-box">
        <div class="student-notes-header">
          ${getSvgIcon('pencil')}
          <span>Student Notes:</span>
        </div>
        <div class="student-notes-body">${escapeHtml(task.notes)}</div>
      </div>
    `;
  }

  const gcalUrl = createGoogleCalendarUrl(task);
  const isSelected = state.selectedTaskId === task.id;

  return `
    <div class="task-card ${isCompleted ? 'is-completed' : ''} ${isSelected ? 'is-active-reading' : ''}" data-task-id="${escapeHtml(task.id)}" style="border-left: 4px solid ${courseTheme.hex} !important;">
      <!-- Course Banner with Permanent Subject Color -->
      <div class="task-course-banner">
        <div class="course-badge-main" style="background: ${courseTheme.bgLight}; border: 1px solid ${courseTheme.border}; color: ${courseTheme.textDark};" title="${escapeHtml(courseName)}${courseCode && courseCode.toLowerCase() !== 'uos' ? ` (${escapeHtml(courseCode)})` : ''}">
          <span class="course-color-dot" style="background: ${courseTheme.hex};"></span>
          <span class="course-name-text">${escapeHtml(courseName)}</span>
          ${courseCode && courseCode.toLowerCase() !== 'uos' ? `<span class="course-code-tag" style="color: ${courseTheme.textDark}; border-color: ${courseTheme.border};">${escapeHtml(courseCode)}</span>` : ''}
        </div>
        <div class="task-header-right" style="display: flex; align-items: center; gap: 6px;">
          <span class="type-pill type-${escapeHtml(task.type || 'assignment')}">
            <span>${typeIcon}</span>
            <span>${typeLabel}</span>
          </span>
        </div>
      </div>

      <!-- Task Title & Done Toggle -->
      <div class="task-title-row">
        <button class="status-checkbox-btn ${isCompleted ? 'checked' : ''}" data-task-id="${escapeHtml(task.id)}" aria-label="Toggle status" title="${isCompleted ? 'Mark as Pending' : 'Mark as Done'}">
          ${isCompleted ? '✓' : ''}
        </button>
        <div class="task-title-text">${escapeHtml(task.title)}</div>
      </div>

      <!-- Urgency Countdown & Weight Pills -->
      <div class="task-due-row">
        <span class="urgency-badge ${countdown.urgency}">
          ${countdown.urgency === 'completed'
            ? `${getSvgIcon('check', 'mr-1')} ${escapeHtml(countdown.label)}`
            : (countdown.urgency === 'overdue' ? `${getSvgIcon('urgent', 'mr-1')} ${escapeHtml(countdown.label)}` : `${getSvgIcon('clock', 'mr-1')} ${escapeHtml(countdown.label)}`)}
        </span>
        ${roomBadgeHtml}
        ${weightBadgeHtml}
        ${classTimeBadgeHtml}
        ${task.scoreDisplay || task.score !== undefined ? `
          <span class="task-grade-pill" title="Grade / Score released on Blackboard">
            ${getSvgIcon('star', 'mr-1')} <span>${escapeHtml(task.scoreDisplay || `${task.score} pts`)}</span>
          </span>
        ` : (task.submissionStatus === 'graded' ? `
          <span class="task-grade-pill">
            ${getSvgIcon('star', 'mr-1')} <span>Graded</span>
          </span>
        ` : '')}
        ${task.submissionStatus === 'submitted' ? `
          <span class="task-submitted-pill" title="${task.submissionReceipt ? `Receipt: ${escapeHtml(task.submissionReceipt)}` : 'Submitted to Blackboard'}">
            ${getSvgIcon('check', 'mr-1')} <span>Submitted</span>
          </span>
        ` : ''}
        ${task.priority === 'high' ? '<span class="meta-pill" style="color:var(--text-main); font-weight:800;">HIGH PRIORITY</span>' : ''}
      </div>

      ${doctorQuoteHtml}
      ${studentNotesHtml}

      <!-- Quick Actions -->
      <div class="task-card-footer">
        <button type="button" class="btn-card-action btn-card-share" data-task-id="${escapeHtml(task.id)}" title="Share task details">
          ${getSvgIcon('share', 'mr-1')} <span class="btn-responsive-label">Share</span>
        </button>
        <a class="btn-card-action btn-card-edit" href="#" data-task-id="${escapeHtml(task.id)}" title="Edit deadline">
          ${getSvgIcon('pencil', 'mr-1')} <span class="btn-responsive-label">Edit</span>
        </a>
        <a class="btn-card-action btn-gcal" href="${gcalUrl}" target="_blank" rel="noopener noreferrer" title="Add to Google Calendar">
          ${getSvgIcon('calendar', 'mr-1')} <span class="btn-responsive-label">G-Calendar</span>
        </a>
        <button class="btn-card-action btn-card-toggle" data-task-id="${escapeHtml(task.id)}">
          ${isCompleted ? `${getSvgIcon('refresh', 'mr-1')} <span class="btn-responsive-label">Mark Pending</span>` : `${getSvgIcon('check', 'mr-1')} <span class="btn-responsive-label">Mark Done</span>`}
        </button>
      </div>
    </div>
  `;
}

function highlightActiveCard(taskId) {
  const container = document.getElementById('deadlines-container');
  if (!container) return;
  container.querySelectorAll('.task-card').forEach(c => {
    if (c.getAttribute('data-task-id') === taskId) {
      c.classList.add('is-active-reading');
    } else {
      c.classList.remove('is-active-reading');
    }
  });
}

function bindTaskCardEvents(parentContainer) {
  // Bind entire card click to select task
  parentContainer.querySelectorAll('.task-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('button, a, input, select')) return;
      const taskId = card.getAttribute('data-task-id');
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;
      state.selectedTaskId = taskId;
      highlightActiveCard(taskId);
      openReadingSheet(task);
    });
  });

  // Bind Share buttons
  parentContainer.querySelectorAll('.btn-card-share').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const taskId = btn.getAttribute('data-task-id');
      const task = state.tasks.find(t => t.id === taskId);
      if (task) shareTaskDetails(task);
    });
  });

  // Bind Edit buttons
  const editButtons = parentContainer.querySelectorAll('.btn-card-edit');
  editButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const taskId = btn.getAttribute('data-task-id');
      const task = state.tasks.find(t => t.id === taskId);
      if (task) openEditTaskModal(task);
    });
  });

  // Bind Quote Toggle (expand/collapse in place)
  const quoteToggles = parentContainer.querySelectorAll('.btn-toggle-quote');
  quoteToggles.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const taskId = btn.getAttribute('data-task-id');
      const quoteBody = document.getElementById(`quote-body-${taskId}`);
      if (!quoteBody) return;
      const isClamped = quoteBody.classList.contains('clamped');
      if (isClamped) {
        quoteBody.classList.remove('clamped');
        quoteBody.classList.add('expanded');
        btn.setAttribute('aria-expanded', 'true');
        const textSpan = btn.querySelector('.quote-toggle-text');
        if (textSpan) textSpan.textContent = 'Show Less ▴';
      } else {
        quoteBody.classList.remove('expanded');
        quoteBody.classList.add('clamped');
        btn.setAttribute('aria-expanded', 'false');
        const textSpan = btn.querySelector('.quote-toggle-text');
        if (textSpan) textSpan.textContent = 'Read Full Announcement ▾';
      }
    });
  });

  // Bind Inspect Quote (open dedicated reading view)
  const inspectButtons = parentContainer.querySelectorAll('.btn-inspect-quote');
  inspectButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const taskId = btn.getAttribute('data-task-id');
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;
      state.selectedTaskId = taskId;
      highlightActiveCard(taskId);
      openReadingSheet(task);
    });
  });

  // Bind Room Pill Button (1-click room picker)
  const roomButtons = parentContainer.querySelectorAll('.room-pill-btn');
  roomButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const taskId = btn.getAttribute('data-task-id');
      openRoomPicker(taskId);
    });
  });

  // Bind Status Toggle with 5-Second Undo & Offline Queue
  const toggleButtons = parentContainer.querySelectorAll('.status-checkbox-btn, .btn-card-toggle');
  toggleButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const taskId = btn.getAttribute('data-task-id');
      const task = state.tasks.find(t => t.id === taskId);
      if (!task) return;

      const prevStatus = task.status;
      const newStatus = prevStatus === 'completed' ? 'pending' : 'completed';
      task.status = newStatus;
      task.updatedAt = new Date().toISOString();

      showToast(
        newStatus === 'completed' ? 'Marked as completed' : 'Reverted to pending',
        'Undo',
        async () => {
          task.status = prevStatus;
          task.updatedAt = new Date().toISOString();
          enqueueOfflineMutation({ type: 'status', taskId, status: prevStatus });
          syncToCloudAndLocal();
          showToast('Status reverted');
        }
      );

      enqueueOfflineMutation({ type: 'status', taskId, status: newStatus });
      syncToCloudAndLocal();
    });
  });
}

function renderReadingPane(task) {
  const pane = document.getElementById('deadlines-reading-pane');
  if (!pane) return;

  if (!task) {
    pane.innerHTML = `
      <div class="reading-pane-card is-empty">
        <div class="state-icon">${getSvgIcon('book')}</div>
        <div class="state-title">Select a Deadline</div>
        <div class="state-desc">Tap any deadline on the left to read its full announcement, room, and syllabus breakdown.</div>
      </div>
    `;
    return;
  }

  const { courseName, courseCode } = resolveCourseInfo(task);
  const courseTheme = getCourseColorTheme(courseName, courseCode, task.title);
  const isCompleted = task.status === 'completed';
  const countdown = formatCountdown(task.dueDate, task.hasSpecificTime, task.status);
  const typeIcon = getTaskTypeIcon(task.type);
  const typeLabel = (task.type || 'assignment').toUpperCase();
  const gcalUrl = createGoogleCalendarUrl(task);

  const fullAnnouncement = (task.description || task.sourceSnippet || '').trim();
  const hasAnnouncement = fullAnnouncement && !fullAnnouncement.startsWith('Blackboard Ultra Stream item');

  let roomDisplay = task.room || 'No room set';

  let weightHtml = '';
  if (task.weightDisplay || task.weight) {
    const displayText = task.weightDisplay || `${task.weight}% of Grade`;
    weightHtml = `<span class="task-weight-pill weight-major">${getSvgIcon('scale', 'mr-1')} ${escapeHtml(displayText)}</span>`;
  }

  pane.innerHTML = `
    <div class="reading-pane-card" style="border-top: 4px solid ${courseTheme.hex};">
      <!-- Course Banner & Type -->
      <div class="reading-pane-top-row">
        <div class="course-badge-main" style="background: ${courseTheme.bgLight}; border: 1px solid ${courseTheme.border}; color: ${courseTheme.textDark};">
          <span class="course-color-dot" style="background: ${courseTheme.hex};"></span>
          <span class="course-name-text">${escapeHtml(courseName)}</span>
          ${courseCode && courseCode.toLowerCase() !== 'uos' ? `<span class="course-code-tag" style="color: ${courseTheme.textDark}; border-color: ${courseTheme.border};">${escapeHtml(courseCode)}</span>` : ''}
        </div>
        <div style="display: flex; align-items: center; gap: 6px;">
          <span class="type-pill type-${escapeHtml(task.type || 'assignment')}">
            <span>${typeIcon}</span>
            <span>${typeLabel}</span>
          </span>
        </div>
      </div>

      <!-- Task Title -->
      <h2 class="reading-pane-title">${escapeHtml(task.title)}</h2>

      <!-- Due Date & Meta Strip -->
      <div class="reading-meta-section">
        <span class="urgency-badge ${countdown.urgency}">
          ${countdown.urgency === 'completed'
            ? `${getSvgIcon('check', 'mr-1')} ${escapeHtml(countdown.label)}`
            : (countdown.urgency === 'overdue' ? `${getSvgIcon('urgent', 'mr-1')} ${escapeHtml(countdown.label)}` : `${getSvgIcon('clock', 'mr-1')} ${escapeHtml(countdown.label)}`)}
        </span>
        <button type="button" class="room-pill-btn reading-room-btn" data-task-id="${escapeHtml(task.id)}" title="Click to change room">
          <span>${getSvgIcon('pin', 'mr-1')} ${escapeHtml(roomDisplay)}</span>
          <span class="room-edit-hint">${getSvgIcon('pencil', 'mr-1')} Change</span>
        </button>
        ${weightHtml}
        ${task.scoreDisplay || task.score !== undefined ? `
          <span class="task-grade-pill" title="Grade / Score released on Blackboard">
            ${getSvgIcon('star', 'mr-1')} <span>${escapeHtml(task.scoreDisplay || `${task.score} pts`)}</span>
          </span>
        ` : (task.submissionStatus === 'graded' ? `
          <span class="task-grade-pill">
            ${getSvgIcon('star', 'mr-1')} <span>Graded</span>
          </span>
        ` : '')}
        ${task.submissionStatus === 'submitted' ? `
          <span class="task-submitted-pill" title="${task.submissionReceipt ? `Receipt: ${escapeHtml(task.submissionReceipt)}` : 'Submitted to Blackboard'}">
            ${getSvgIcon('check', 'mr-1')} <span>Submitted</span>
          </span>
        ` : ''}
        ${!task.hasSpecificTime ? `<span class="meta-pill time-class">${getSvgIcon('clock', 'mr-1')} Class Time</span>` : ''}
        ${task.priority === 'high' ? '<span class="meta-pill" style="color:var(--text-main); font-weight:800;">HIGH PRIORITY</span>' : ''}
      </div>

      <!-- Syllabus Context if available -->
      ${task.syllabusNote ? `
        <div style="font-size: 11.5px; color: var(--text-muted); background: #f1f5f9; padding: 7px 10px; border-radius: var(--radius-sm);">
          ${getSvgIcon('book', 'mr-1')} <strong>Syllabus Weight:</strong> ${escapeHtml(task.syllabusNote)}
        </div>
      ` : ''}

      <!-- Doctor Announcement Section -->
      <div class="reading-announcement-box">
        <div class="reading-box-header">
          <span class="reading-box-title">
            <span>${getSvgIcon('message', 'mr-1')}</span>
            <span>Doctor Announcement & Instructions</span>
          </span>
          ${hasAnnouncement ? `
            <button type="button" class="btn-copy-announcement" id="btn-copy-reading-text">
              <span>${getSvgIcon('copy', 'mr-1')}</span>
              <span id="copy-reading-label">Copy Text</span>
            </button>
          ` : ''}
        </div>
        <div class="reading-box-content">
          ${hasAnnouncement ? escapeHtml(fullAnnouncement) : '<span style="color: var(--text-muted); font-style: italic;">No detailed announcement body attached to this item.</span>'}
        </div>
      </div>

      <!-- Student Personal Notes -->
      ${task.notes && task.notes.trim() ? `
        <div class="reading-notes-box" style="margin-top: 12px; padding: 12px 14px; background: var(--surface-hover); border-left: 3px solid var(--text-main); border-radius: var(--radius-sm);">
          <div style="font-size: 12px; font-weight: 700; color: var(--text-main); display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
            ${getSvgIcon('pencil')}
            <span>Student Personal Notes</span>
          </div>
          <div style="font-size: 13px; color: var(--text-main); white-space: pre-wrap; line-height: 1.5;">${escapeHtml(task.notes)}</div>
        </div>
      ` : ''}

      <!-- Actions Bar -->
      <div class="reading-actions-bar">
        <button type="button" class="btn-primary-action reading-toggle-status-btn" data-task-id="${escapeHtml(task.id)}" style="min-height: 40px; font-size: 12px; padding: 0 14px;">
          ${isCompleted ? `${getSvgIcon('refresh', 'mr-1')} Mark as Pending` : `${getSvgIcon('check', 'mr-1')} Mark as Completed`}
        </button>
        <button type="button" class="btn-outline-action reading-share-btn" data-task-id="${escapeHtml(task.id)}" style="min-height: 40px; font-size: 12px; padding: 0 12px;">
          <span>${getSvgIcon('share', 'mr-1')} Share</span>
        </button>
        <a class="btn-outline-action" href="${gcalUrl}" target="_blank" rel="noopener noreferrer" style="min-height: 40px; font-size: 12px; padding: 0 12px; text-decoration: none;">
          <span>${getSvgIcon('calendar', 'mr-1')} Google Calendar</span>
        </a>
        <button type="button" class="btn-outline-action reading-edit-btn" data-task-id="${escapeHtml(task.id)}" style="min-height: 40px; font-size: 12px; padding: 0 12px;">
          <span>${getSvgIcon('pencil', 'mr-1')} Edit</span>
        </button>
      </div>
    </div>
  `;

  // Bind Reading Pane Events
  const copyBtn = document.getElementById('btn-copy-reading-text');
  if (copyBtn && hasAnnouncement) {
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(fullAnnouncement);
        const label = document.getElementById('copy-reading-label');
        if (label) {
          label.textContent = 'Copied!';
          setTimeout(() => { label.textContent = 'Copy Text'; }, 2000);
        }
        showToast('Announcement text copied to clipboard!');
      } catch (e) {
        showToast('Could not copy to clipboard.');
      }
    };
  }

  pane.querySelector('.reading-share-btn')?.addEventListener('click', () => {
    shareTaskDetails(task);
  });

  pane.querySelector('.reading-room-btn')?.addEventListener('click', () => {
    openRoomPicker(task.id);
  });

  pane.querySelector('.reading-edit-btn')?.addEventListener('click', () => {
    openEditTaskModal(task);
  });

  pane.querySelector('.reading-toggle-status-btn')?.addEventListener('click', () => {
    const prevStatus = task.status;
    const newStatus = prevStatus === 'completed' ? 'pending' : 'completed';
    task.status = newStatus;
    task.updatedAt = new Date().toISOString();

    showToast(
      newStatus === 'completed' ? 'Marked as completed' : 'Reverted to pending',
      'Undo',
      async () => {
        task.status = prevStatus;
        task.updatedAt = new Date().toISOString();
        enqueueOfflineMutation({ type: 'status', taskId: task.id, status: prevStatus });
        syncToCloudAndLocal();
        showToast('Status reverted');
      }
    );

    enqueueOfflineMutation({ type: 'status', taskId: task.id, status: newStatus });
    syncToCloudAndLocal();
  });
}

function updateStats() {
  const now = Date.now();
  let urgentCount = 0;
  let weekCount = 0;
  let totalCount = 0;

  for (const t of state.tasks) {
    if (t.status !== 'completed') {
      totalCount++;
      const dueTime = new Date(t.dueDate).getTime();
      const hoursLeft = (dueTime - now) / (1000 * 3600);
      if (hoursLeft > -12 && hoursLeft <= 48) {
        urgentCount++;
      }
      if (hoursLeft > 0 && hoursLeft <= 7 * 24) {
        weekCount++;
      }
    }
  }

  const elUrgent = document.getElementById('stat-urgent-num');
  const elWeek = document.getElementById('stat-week-num');
  const elTotal = document.getElementById('stat-total-num');

  if (elUrgent) elUrgent.textContent = String(urgentCount);
  if (elWeek) elWeek.textContent = String(weekCount);
  if (elTotal) elTotal.textContent = String(totalCount);
}

function updateBadgeCounts() {
  const pendingCount = state.tasks.filter(t => t.status !== 'completed').length;
  const badge = document.getElementById('badge-deadlines-count');
  if (badge) badge.textContent = String(pendingCount);
}

// ==========================================================================
// Syllabus Grade Progress Tracker & Simulator
// ==========================================================================
function renderGradeTracker() {
  const badge = document.getElementById('mobile-grade-overall-badge');
  const breakdown = document.getElementById('mobile-grade-tracker-breakdown');
  if (!badge || !breakdown) return;
  // Every mark in one place, grouped by course (same list as the extension)
  const summary = BB.buildMarksSummary(state.tasks, DEFAULT_SYLLABUS_DATABASE);
  badge.textContent = BB.marksBadgeText(summary);
  breakdown.innerHTML = BB.marksSummaryHtml(summary, name => getCourseColor('', name));

  // Syllabus Progress card
  const sylBadge = document.getElementById('mobile-syllabus-tracker-badge');
  const sylBody = document.getElementById('mobile-syllabus-tracker-breakdown');
  if (sylBadge && sylBody) {
    const progress = BB.buildSyllabusProgress(state.tasks, DEFAULT_SYLLABUS_DATABASE);
    sylBadge.textContent = `${progress.overallPercent}% done`;
    sylBody.innerHTML = BB.syllabusProgressHtml(progress, name => getCourseColor('', name));
  }
}

function initGradeTracker() {
  const sylBtn = document.getElementById('mobile-syllabus-tracker-toggle-btn');
  const sylBody = document.getElementById('mobile-syllabus-tracker-breakdown');
  const sylArrow = document.getElementById('mobile-syllabus-tracker-arrow');
  sylBtn?.addEventListener('click', () => {
    if (!sylBody) return;
    const isHidden = sylBody.style.display === 'none' || !sylBody.style.display;
    sylBody.style.display = isHidden ? 'flex' : 'none';
    if (sylArrow) sylArrow.style.transform = isHidden ? 'rotate(90deg)' : 'rotate(0deg)';
  });

  const toggleBtn = document.getElementById('mobile-grade-tracker-toggle-btn');
  const breakdown = document.getElementById('mobile-grade-tracker-breakdown');
  const arrow = document.getElementById('mobile-grade-arrow');

  toggleBtn?.addEventListener('click', () => {
    if (!breakdown) return;
    const isHidden = breakdown.style.display === 'none' || !breakdown.style.display;
    breakdown.style.display = isHidden ? 'flex' : 'none';
    if (arrow) {
      arrow.style.transform = isHidden ? 'rotate(90deg)' : 'rotate(0deg)';
    }
  });
}

// ==========================================================================
// VIEW 3: Schedule & Syllabus
// ==========================================================================
function initScheduleAndSyllabus() {
  const scheduleContainer = document.getElementById('schedule-timeline-container');
  if (scheduleContainer) {
    if (STUDENT_CLASS_SCHEDULE.length === 0) {
      scheduleContainer.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:12px 4px;">No class meeting times configured. Add courses in the Chrome extension to display your schedule here.</div>';
    } else {
      scheduleContainer.innerHTML = STUDENT_CLASS_SCHEDULE.map(s => {
        const color = getCourseColor(s.courseCode, s.courseName);
        const codePrefix = s.courseCode ? `${escapeHtml(s.courseCode)}: ` : '';
        const dayRoom = [s.days, s.room].filter(Boolean).map(escapeHtml).join(' • ');
        return `
          <div class="schedule-row" style="border-left-color: ${color};">
            <div class="schedule-course-info">
              <div class="schedule-course-name">${codePrefix}${escapeHtml(s.courseName)}</div>
              <div class="schedule-days-badge">${dayRoom || 'TBA'}</div>
            </div>
            <div class="schedule-time-badge">${escapeHtml(s.time || 'TBA')}</div>
          </div>
        `;
      }).join('');
    }
  }

  const syllabusContainer = document.getElementById('syllabus-distribution-container');
  if (syllabusContainer) {
    if (SYLLABUS_INFO.length === 0) {
      syllabusContainer.innerHTML = '<div style="font-size:12px; color:var(--text-muted); padding:12px 4px;">No syllabus mark allocations configured. Add course syllabi in the Chrome extension to display weight distributions here.</div>';
    } else {
      syllabusContainer.innerHTML = SYLLABUS_INFO.map(item => `
        <div class="syllabus-item-card">
          <div class="syllabus-item-title">${escapeHtml(item.courseCode ? `${item.courseCode} - ` : '')}${escapeHtml(item.courseName)}</div>
          <div class="syllabus-item-details">${escapeHtml(item.breakdown || 'No components specified')}</div>
        </div>
      `).join('');
    }
  }
}

// ==========================================================================
// VIEW 4: Settings, Push Notifications & WebCal
// ==========================================================================
function initSettings() {
  const host = window.location.host || 'localhost:3456';
  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';

  // WebCal and Device Pairing setup
  const feedUrlText = document.getElementById('feed-url-text');
  const btnWebcal = document.getElementById('btn-webcal-subscribe');
  const btnCopy = document.getElementById('btn-copy-webcal');
  const syncKeyStatus = document.getElementById('web-sync-key-status');
  const statusIndicator = document.getElementById('web-sync-status-indicator');
  const instructionText = document.getElementById('web-sync-instruction-text');
  const btnDisconnectDevice = document.getElementById('btn-disconnect-device');
  const inputSyncKey = document.getElementById('web-sync-key-input');
  const btnSaveSyncKey = document.getElementById('btn-save-web-sync-key');
  const btnCopySyncKey = document.getElementById('btn-copy-web-sync-key');

  function updateFeedUrls() {
    const activeSyncKey = getSyncKey();
    const query = activeSyncKey ? `?key=${encodeURIComponent(activeSyncKey)}` : '';

    const currentFeedUrl = `${protocol}//${host}/feed.ics${query}`;
    const currentWebcalUrl = `webcal://${host}/feed.ics${query}`;

    if (feedUrlText) feedUrlText.textContent = currentFeedUrl;
    if (btnWebcal) btnWebcal.setAttribute('href', currentWebcalUrl);
    return currentFeedUrl;
  }

  function updateDevicePairingCard() {
    const activeKey = getSyncKey();
    if (inputSyncKey && !inputSyncKey.matches(':focus')) {
      inputSyncKey.value = activeKey || '';
    }
    if (activeKey) {
      if (syncKeyStatus) syncKeyStatus.textContent = `Paired: ${activeKey}`;
      if (statusIndicator) statusIndicator.style.background = 'var(--text-main)';
      if (instructionText) instructionText.textContent = `This device is linked to your personal cloud bucket (${activeKey}). Deadlines and calendar feeds are active.`;
      if (btnDisconnectDevice) btnDisconnectDevice.style.display = 'inline-block';
      if (btnCopySyncKey) btnCopySyncKey.style.display = 'inline-flex';
    } else {
      if (syncKeyStatus) syncKeyStatus.textContent = 'Not Paired';
      if (statusIndicator) statusIndicator.style.background = '#94a3b8';
      if (instructionText) instructionText.textContent = 'Keys are generated inside your Chrome extension (under Settings > Personal Sync Key). Enter your code below to link your private cloud bucket, or open via your phone pairing link.';
      if (btnDisconnectDevice) btnDisconnectDevice.style.display = 'none';
      if (btnCopySyncKey) btnCopySyncKey.style.display = 'none';
    }
  }

  let activeFeedUrl = updateFeedUrls();
  updateDevicePairingCard();

  btnSaveSyncKey?.addEventListener('click', async () => {
    const rawVal = inputSyncKey ? inputSyncKey.value.trim().toUpperCase() : '';
    if (!rawVal) {
      showToast('Please enter a Sync Key from your Chrome extension.');
      return;
    }
    const clean = rawVal.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!clean) {
      showToast('Invalid key format. Please enter a valid Sync Key.');
      return;
    }

    const prevKey = getSyncKey();
    if (clean !== prevKey) {
      if (prevKey) {
        resetLocalDataForNewKey();
        state.tasks = [];
        state.quickLinks = [];
      }
      state.userCourses = [];
      state.coursesUpdatedAt = null;
      const scoped = localStorage.getItem(`bbs_mobile_courses_${clean}`);
      if (scoped) {
        try {
          state.userCourses = JSON.parse(scoped) || [];
        } catch {}
      }
      recompileDynamicCourseData(state.userCourses);
      initLegend();
      initScheduleAndSyllabus();
      renderGradeTracker();
      updateCourseDatalist();
    }

    localStorage.setItem('bbs_sync_key', clean);
    if (window.history && window.history.replaceState) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    updateDevicePairingCard();
    activeFeedUrl = updateFeedUrls();
    showToast(`Device paired with key ${clean}! Fetching deadlines...`);
    await fetchTasksFromServer(true);
    updateAllViews();
  });

  inputSyncKey?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      btnSaveSyncKey?.click();
    }
  });

  btnCopySyncKey?.addEventListener('click', async () => {
    const activeKey = getSyncKey();
    if (!activeKey) {
      showToast('No active sync key to copy.');
      return;
    }
    try {
      await navigator.clipboard.writeText(activeKey);
      showToast(`Copied sync key "${activeKey}" to clipboard!`);
    } catch (err) {
      showToast(`Sync Key: ${activeKey}`);
    }
  });

  btnDisconnectDevice?.addEventListener('click', async () => {
    if (confirm('Disconnect this device from your extension sync key?')) {
      const oldKey = getSyncKey();
      if (oldKey) {
        localStorage.removeItem(`bbs_mobile_courses_${oldKey}`);
      }
      localStorage.removeItem('bbs_mobile_courses');
      localStorage.removeItem('bbs_mobile_courses_updated_at');
      localStorage.removeItem('bbs_sync_key');
      resetLocalDataForNewKey();
      if (inputSyncKey) inputSyncKey.value = '';
      if (window.history && window.history.replaceState) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
      state.tasks = [];
      state.userCourses = [];
      state.coursesUpdatedAt = null;
      recompileDynamicCourseData([]);
      recalculateAllTaskWeightsAndRooms();
      initLegend();
      initScheduleAndSyllabus();
      renderGradeTracker();
      updateCourseDatalist();
      updateAllViews();
      syncTasksToServiceWorker();
      updateDevicePairingCard();
      activeFeedUrl = updateFeedUrls();
      showToast('Device disconnected. Open pairing link from extension to reconnect.');
    }
  });


  btnCopy?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(activeFeedUrl);
      const copyIcon = document.getElementById('copy-btn-icon');
      const copyTxt = document.getElementById('copy-btn-text');
      if (copyIcon && copyTxt) {
        copyIcon.innerHTML = '<use href="#icon-check"></use>';
        copyTxt.textContent = 'Copied to Clipboard!';
        setTimeout(() => {
          copyIcon.innerHTML = '<use href="#icon-copy"></use>';
          copyTxt.textContent = 'Copy Calendar Feed URL';
        }, 2500);
      }
      showToast('Calendar feed link copied! Paste into Google Calendar or Apple Calendar.');
    } catch (e) {
      showToast('Could not copy automatically. Please copy the URL text manually.');
    }
  });

  // iOS Scriptable widget: widget.js is generated from widgets/blackboarder-widget.js

  const btnCopyWidget = document.getElementById('btn-copy-widget-code');
  btnCopyWidget?.addEventListener('click', async () => {
    try {
      let code = '';
      try {
        const resp = await fetch('./widget.js', { cache: 'no-store' });
        if (resp.ok) {
          code = await resp.text();
        }
      } catch (err) {}

      if (!code) throw new Error('widget.js unavailable');

      const activeSyncKey = getSyncKey() || '';
      if (activeSyncKey) {
        code = code.replace('let SYNC_KEY = "";', `let SYNC_KEY = ${JSON.stringify(activeSyncKey)};`);
      }
      // Point the widget at whichever server this app is running on
      if (location.protocol === 'https:') {
        code = code.replace(/https:\/\/blackboarder\.pages\.dev/g, location.origin);
      }

      await navigator.clipboard.writeText(code);
      const btnTxt = document.getElementById('btn-copy-widget-text');
      if (btnTxt) {
        const orig = btnTxt.textContent;
        btnTxt.textContent = 'Copied to Clipboard! ✓';
        setTimeout(() => {
          btnTxt.textContent = orig;
        }, 2500);
      }
      showToast('Widget script copied! Open Scriptable and paste to update your widget.');
    } catch (e) {
      showToast('Could not copy the widget script. Check your connection and try again.');
    }
  });

  // Push Notifications Setup
  const togglePush = document.getElementById('toggle-push-notif');
  const permStatus = document.getElementById('notif-permission-status');
  const btnTestNotif = document.getElementById('btn-test-notification');
  const selAdvance = document.getElementById('select-notif-advance');
  const selUrgent = document.getElementById('select-notif-urgent');
  const toggleDue = document.getElementById('toggle-notif-due');
  const summaryAdv = document.getElementById('timing-summary-advance');
  const summaryUrg = document.getElementById('timing-summary-urgent');
  const summaryDue = document.getElementById('timing-summary-due');

  function updateNotificationUi() {
    const advH = getNotifAdvanceHours();
    const urgH = getNotifUrgentHours();
    const dueOn = getNotifDueAlertEnabled();

    if (selAdvance) selAdvance.value = String(advH);
    if (selUrgent) selUrgent.value = String(urgH);
    if (toggleDue) toggleDue.checked = dueOn;

    if (summaryAdv) {
      if (advH > 0) {
        const label = advH >= 24 ? `${Math.round(advH / 24)} Day${advH >= 48 ? 's' : ''}` : `${advH} Hours`;
        summaryAdv.innerHTML = `<strong>${label} Before:</strong> Advance reminder for pending submissions.`;
      } else {
        summaryAdv.innerHTML = `<strong>Advance Alert:</strong> Disabled.`;
      }
    }

    if (summaryUrg) {
      if (urgH > 0) {
        const label = urgH < 1 ? `${Math.round(urgH * 60)} Minutes` : `${urgH} Hour${urgH > 1 ? 's' : ''}`;
        summaryUrg.innerHTML = `<strong>${label} Before:</strong> Final countdown alert for imminent deadlines.`;
      } else {
        summaryUrg.innerHTML = `<strong>Countdown Alert:</strong> Disabled.`;
      }
    }

    if (summaryDue) {
      summaryDue.innerHTML = dueOn
        ? `<strong>At Due Time:</strong> Immediate alert when due window arrives.`
        : `<strong>Due Time Alert:</strong> Disabled.`;
    }

    if (!('Notification' in window)) {
      if (permStatus) permStatus.textContent = 'Not supported in this browser';
      if (togglePush) togglePush.disabled = true;
      return;
    }

    const perm = Notification.permission;
    const isSavedActive = localStorage.getItem('bbs_push_enabled') === 'true';

    if (perm === 'granted' && isSavedActive) {
      const advLabel = advH > 0 ? (advH >= 24 ? `${Math.round(advH / 24)}d` : `${advH}h`) : 'off';
      const urgLabel = urgH > 0 ? (urgH < 1 ? `${Math.round(urgH * 60)}m` : `${urgH}h`) : 'off';
      if (permStatus) permStatus.textContent = `Active: Alerts at ${advLabel} & ${urgLabel}`;
      if (togglePush) togglePush.checked = true;
    } else if (perm === 'denied') {
      if (permStatus) permStatus.textContent = 'Blocked by browser permissions';
      if (togglePush) {
        togglePush.checked = false;
        togglePush.disabled = true;
      }
    } else {
      if (permStatus) permStatus.textContent = 'Disabled (Tap switch to enable)';
      if (togglePush) togglePush.checked = false;
    }
  }

  updateNotificationUi();

  selAdvance?.addEventListener('change', () => {
    const val = parseFloat(selAdvance.value);
    localStorage.setItem('bbs_notif_advance_hours', String(val));
    updateNotificationUi();
    syncTasksToServiceWorker();
    checkUpcomingDeadlines(false);
    showToast(val > 0 ? `Advance reminder set to ${val >= 24 ? val / 24 + ' days' : val + ' hours'} before.` : 'Advance reminder disabled.');
  });

  selUrgent?.addEventListener('change', () => {
    const val = parseFloat(selUrgent.value);
    localStorage.setItem('bbs_notif_urgent_hours', String(val));
    updateNotificationUi();
    syncTasksToServiceWorker();
    checkUpcomingDeadlines(false);
    showToast(val > 0 ? `Urgent countdown alert set to ${val < 1 ? (val * 60) + ' mins' : val + ' hours'} before.` : 'Urgent alert disabled.');
  });

  toggleDue?.addEventListener('change', () => {
    const val = toggleDue.checked;
    localStorage.setItem('bbs_notif_due_alert', String(val));
    updateNotificationUi();
    syncTasksToServiceWorker();
    checkUpcomingDeadlines(false);
    showToast(val ? 'Due time alert enabled.' : 'Due time alert disabled.');
  });

  togglePush?.addEventListener('change', async () => {
    if (togglePush.checked) {
      if ('Notification' in window) {
        const result = await Notification.requestPermission();
        if (result === 'granted') {
          localStorage.setItem('bbs_push_enabled', 'true');
          updateNotificationUi();
          registerPeriodicSync();
          syncTasksToServiceWorker();
          await checkUpcomingDeadlines(true);
          showToast('Notifications enabled! You will receive countdown alerts.');
        } else {
          togglePush.checked = false;
          localStorage.setItem('bbs_push_enabled', 'false');
          updateNotificationUi();
          showToast('Notification permission was not granted.');
        }
      }
    } else {
      localStorage.setItem('bbs_push_enabled', 'false');
      updateNotificationUi();
      syncTasksToServiceWorker();
      showToast('Mobile push notifications turned off.');
    }
  });

  btnTestNotif?.addEventListener('click', async () => {
    if (!('Notification' in window)) {
      showToast('Notifications are not supported on this device.');
      return;
    }

    if (Notification.permission === 'granted') {
      const now = Date.now();
      const nextTask = (state.tasks || []).find(t => t.status !== 'completed' && new Date(t.dueDate).getTime() >= now) || (state.tasks || [])[0];
      let title = '🚨 Blackboarder Alert';
      let body = 'Calculus I for Engineering (1440 133)\n🕒 Due: Tomorrow at 12:30 PM (in ~24 hours)\n📍 Room: A12-110';

      if (nextTask) {
        const urgH = getNotifUrgentHours();
        const label = urgH > 0 ? (urgH < 1 ? `${Math.round(urgH * 60)}m` : `${urgH}h`) : '2h';
        const payload = formatNotificationPayload(nextTask, label, Math.max(0, new Date(nextTask.dueDate).getTime() - now));
        title = payload.title;
        body = payload.body;
      }

      const sent = await sendMobileNotification(title, {
        body,
        tag: 'bbs-test-notification',
        renotify: false,
        vibrate: [200, 100, 200],
        data: { url: './index.html', taskId: nextTask?.id }
      });

      if (sent) {
        showToast('Sent test notification to your screen!');
      } else {
        showToast('Notification triggered (check your notifications shade).');
      }
    } else {
      showToast('Please enable the Push Alerts toggle switch first.');
    }
  });


  // Backup & Data Management (JSON & ICS)
  document.getElementById('btn-web-backup-json')?.addEventListener('click', () => {
    exportJsonBackup();
  });

  const restoreInput = document.getElementById('input-web-restore-json');
  document.getElementById('btn-web-restore-trigger')?.addEventListener('click', () => {
    restoreInput?.click();
  });

  restoreInput?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (file) {
      await handleRestoreJson(file);
      restoreInput.value = '';
    }
  });

  document.getElementById('btn-web-export-ics')?.addEventListener('click', () => {
    exportAllIcs();
  });
}

// ==========================================================================
// Toast Notification Helper with 5-Second Undo Action
// ==========================================================================
function showToast(message, actionText = null, onAction = null) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  // Clear previous toast immediately for crisp, instant feedback
  container.innerHTML = '';

  const toast = document.createElement('div');
  toast.className = 'toast';

  const textSpan = document.createElement('span');
  textSpan.textContent = message;
  toast.appendChild(textSpan);

  if (actionText && typeof onAction === 'function') {
    const actionBtn = document.createElement('button');
    actionBtn.className = 'toast-btn-action';
    actionBtn.textContent = actionText;
    actionBtn.type = 'button';
    actionBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toast.remove();
      onAction();
    });
    toast.appendChild(actionBtn);
  }

  container.appendChild(toast);

  const duration = actionText ? 5000 : 3200;
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.2s ease-in';
    setTimeout(() => toast.remove(), 250);
  }, duration);
}

// ==========================================================================
// Offline Mutation Queue & Cloud Sync Manager
// ==========================================================================
const MUTATION_QUEUE_KEY = 'bbs_offline_mutation_queue';

function getOfflineMutations() {
  try {
    const raw = localStorage.getItem(MUTATION_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function enqueueOfflineMutation(mutation) {
  const queue = getOfflineMutations();
  queue.push({
    ...mutation,
    id: 'mut_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
    timestamp: new Date().toISOString()
  });
  localStorage.setItem(MUTATION_QUEUE_KEY, JSON.stringify(queue));
}

function clearOfflineMutations() {
  localStorage.removeItem(MUTATION_QUEUE_KEY);
}

let isFlushingMutations = false;
async function flushOfflineMutations() {
  if (isFlushingMutations || !navigator.onLine) return;
  if (getOfflineMutations().length === 0) return;

  isFlushingMutations = true;
  try {
    // Every queued mutation is already applied to state.tasks, so one full-state push replaces them.
    // Per-key writes such as /tasks/<id>.json must not be used: they turn the Firebase tasks
    // array into an object, which every client then reads as "no tasks".
    await syncToCloudAndLocal();
  } catch (err) {
    console.warn('Failed to flush offline mutations:', err);
  } finally {
    isFlushingMutations = false;
  }
}

// ==========================================================================
// Native Share / Copy Task Details
// ==========================================================================
async function shareTaskDetails(task) {
  if (!task) return;
  const { courseName, courseCode } = resolveCourseInfo(task);
  const dueFormatted = formatCountdown(task.dueDate, task.hasSpecificTime).label;
  const shareText = `📌 ${task.title}\n📚 ${courseCode || courseName}\n⏰ Due: ${dueFormatted}${task.room ? '\n📍 Room: ' + task.room : ''}${task.weightDisplay ? '\n⚖️ ' + task.weightDisplay : ''}\n\nManaged with Blackboarder`;

  if (navigator.share) {
    try {
      await navigator.share({
        title: task.title,
        text: shareText,
        url: window.location.href
      });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }

  try {
    await navigator.clipboard.writeText(shareText);
    showToast('Task details copied to clipboard!');
  } catch (e) {
    showToast('Could not copy task details.');
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function initModals() {
  // Add Deadline Button in Deadlines view
  document.getElementById('btn-add-deadline')?.addEventListener('click', () => {
    openAddTaskModal();
  });

  // Edit Modal Close & Cancel
  document.getElementById('btn-close-edit-modal')?.addEventListener('click', closeEditModal);
  document.getElementById('btn-cancel-edit')?.addEventListener('click', closeEditModal);
  document.getElementById('modal-edit-task')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-edit-task') closeEditModal();
  });

  // Add Modal Close & Cancel
  document.getElementById('btn-close-add-modal')?.addEventListener('click', closeAddModal);
  document.getElementById('btn-cancel-add')?.addEventListener('click', closeAddModal);
  document.getElementById('modal-add-task')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-add-task') closeAddModal();
  });

  // Reading Sheet Close
  document.getElementById('btn-close-reading-sheet')?.addEventListener('click', closeReadingSheet);
  document.getElementById('modal-reading-sheet')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-reading-sheet') closeReadingSheet();
  });

  // Room Picker Close
  document.getElementById('btn-close-room-picker')?.addEventListener('click', closeRoomPicker);
  document.getElementById('modal-room-picker')?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-room-picker') closeRoomPicker();
  });

  // AI Extract Modal Open, Close & Backdrop
  const extractModal = document.getElementById('modal-ai-extract');
  function closeExtractModal() {
    if (extractModal) {
      extractModal.style.display = 'none';
      extractModal.classList.add('hidden');
    }
  }

  document.getElementById('btn-ai-extract-modal')?.addEventListener('click', () => {
    if (extractModal) {
      extractModal.style.display = 'flex';
      extractModal.classList.remove('hidden');
      const input = document.getElementById('input-extract-text');
      if (input) input.focus();
    }
  });
  document.getElementById('btn-close-extract-modal')?.addEventListener('click', closeExtractModal);
  document.getElementById('btn-cancel-extract')?.addEventListener('click', closeExtractModal);
  extractModal?.addEventListener('click', (e) => {
    if (e.target.id === 'modal-ai-extract') closeExtractModal();
  });

  // Save Custom Room Button
  document.getElementById('btn-apply-custom-room')?.addEventListener('click', async () => {
    if (!activeRoomPickerTaskId) return;
    const customVal = document.getElementById('input-custom-room')?.value.trim() || '';
    await applyRoomChange(activeRoomPickerTaskId, customVal);
    closeRoomPicker();
  });

  // Escape key closes modals
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeDaySheet();
      closeEditModal();
      closeAddModal();
      closeReadingSheet();
      closeRoomPicker();
      closeExtractModal();
      closeQuickLinksModal();
    }
  });

  // Auto-weight calculation in Add and Edit modals
  document.getElementById('btn-calc-add-weight')?.addEventListener('click', () => {
    const course = document.getElementById('add-course')?.value || '';
    const title = document.getElementById('add-title')?.value || '';
    const type = document.getElementById('add-type')?.value || 'assignment';
    const notes = document.getElementById('add-notes')?.value || '';
    const weightInfo = resolveTaskWeight(course, title, type, notes);

    const weightInput = document.getElementById('add-weight');
    const hintSpan = document.getElementById('add-weight-hint');

    if (weightInfo.weight !== undefined) {
      if (weightInput) weightInput.value = weightInfo.weight;
      if (hintSpan) {
        hintSpan.innerHTML = `${getSvgIcon('scale', 'mr-1')} <strong>${escapeHtml(weightInfo.weightDisplay)}</strong>: ${escapeHtml(weightInfo.syllabusNote || '')}`;
        hintSpan.style.color = 'var(--primary)';
      }
      showToast(`Auto-detected weight: ${weightInfo.weightDisplay}`);
    } else {
      if (hintSpan) {
        hintSpan.textContent = 'No matching syllabus rule found for this item.';
        hintSpan.style.color = 'var(--text-muted)';
      }
      showToast('Could not automatically match syllabus component.');
    }
  });

  document.getElementById('btn-calc-edit-weight')?.addEventListener('click', () => {
    const course = document.getElementById('edit-course')?.value || '';
    const title = document.getElementById('edit-title')?.value || '';
    const type = document.getElementById('edit-type')?.value || 'assignment';
    const desc = document.getElementById('edit-desc')?.value || '';
    const notes = document.getElementById('edit-notes')?.value || '';
    const weightInfo = resolveTaskWeight(course, title, type, `${desc} ${notes}`);

    const weightInput = document.getElementById('edit-weight');
    const hintSpan = document.getElementById('edit-weight-hint');

    if (weightInfo.weight !== undefined) {
      if (weightInput) weightInput.value = weightInfo.weight;
      if (hintSpan) {
        hintSpan.innerHTML = `${getSvgIcon('scale', 'mr-1')} <strong>${escapeHtml(weightInfo.weightDisplay)}</strong>: ${escapeHtml(weightInfo.syllabusNote || '')}`;
        hintSpan.style.color = 'var(--primary)';
      }
      showToast(`Auto-detected weight: ${weightInfo.weightDisplay}`);
    } else {
      if (hintSpan) {
        hintSpan.textContent = 'No matching syllabus rule found for this item.';
        hintSpan.style.color = 'var(--text-muted)';
      }
      showToast('Could not automatically match syllabus component.');
    }
  });

  // Type change listeners to dynamically toggle room visibility in Add and Edit modals
  document.getElementById('edit-type')?.addEventListener('change', (e) => {
    const val = e.target.value;
    const isHw = val === 'assignment' || val === 'hw' || val === 'project';
    const roomInput = document.getElementById('edit-room');
    const group = roomInput ? roomInput.closest('.form-group') : null;
    if (group) group.style.display = isHw ? 'none' : '';
    if (isHw && roomInput) roomInput.value = '';
  });

  document.getElementById('add-type')?.addEventListener('change', (e) => {
    const val = e.target.value;
    const isHw = val === 'assignment' || val === 'hw' || val === 'project';
    const roomInput = document.getElementById('add-room');
    const group = roomInput ? roomInput.closest('.form-group') : null;
    if (group) group.style.display = isHw ? 'none' : '';
    if (isHw && roomInput) roomInput.value = '';
  });

  // Auto-suggest default room and meeting time when entering course in Add Modal
  const addCourseInput = document.getElementById('add-course');
  const addRoomInput = document.getElementById('add-room');
  const addTimeInput = document.getElementById('add-time');
  addCourseInput?.addEventListener('input', () => {
    const courseVal = addCourseInput.value;
    const addTypeVal = document.getElementById('add-type')?.value;
    const isHwOrProj = addTypeVal === 'assignment' || addTypeVal === 'hw' || addTypeVal === 'project';
    for (const s of STUDENT_CLASS_SCHEDULE) {
      if (s.matcher.test(courseVal)) {
        if (!isHwOrProj && addRoomInput && !addRoomInput.value) {
          addRoomInput.value = s.room;
        }
        if (addTimeInput && (!addTimeInput.value || addTimeInput.value === '23:59')) {
          addTimeInput.value = `${String(s.startHour).padStart(2, '0')}:${String(s.startMinute).padStart(2, '0')}`;
        }
        break;
      }
    }
  });

  // Execute 3-Tier Hybrid Extraction in Modal
  const btnRunExtract = document.getElementById('btn-run-extract');
  btnRunExtract?.addEventListener('click', async () => {
    const textArea = document.getElementById('input-extract-text');
    const courseSelect = document.getElementById('extract-course-hint');
    const statusBox = document.getElementById('extract-status-box');
    const previewList = document.getElementById('extract-preview-list');
    const btnIcon = document.getElementById('extract-btn-icon');
    const btnText = document.getElementById('extract-btn-text');

    const text = (textArea?.value || '').trim();
    const courseHint = courseSelect?.value || '';

    if (!text) {
      showToast('Please paste an announcement text first.');
      return;
    }

    if (btnRunExtract) btnRunExtract.disabled = true;
    if (btnIcon) btnIcon.innerHTML = getSvgIcon('refresh');
    if (btnText) btnText.textContent = 'Analyzing...';
    if (statusBox) {
      statusBox.style.display = 'block';
      statusBox.innerHTML = `
        <div class="extract-status-pill loading">
          <span>${getSvgIcon('bolt', 'mr-1')} Running 3-Tier Hybrid Extraction (Regex + Jev Gatekeeper + Generative AI)...</span>
        </div>
      `;
    }
    if (previewList) previewList.innerHTML = '';

    try {
      const result = await extractAnnouncementHybrid(text, courseHint);

      if (result.rejected) {
        if (statusBox) {
          statusBox.innerHTML = `
            <div class="extract-status-pill rejected">
              <span>${getSvgIcon('urgent', 'mr-1')} ${escapeHtml(result.reason || 'Filtered out as non-assessment.')}</span>
            </div>
          `;
        }
        showToast('Filtered out: No assessment detected in this text.');
        return;
      }

      if (!result.tasks || result.tasks.length === 0) {
        if (statusBox) {
          statusBox.innerHTML = `
            <div class="extract-status-pill error">
              <span>No deadline dates detected in this announcement.</span>
            </div>
          `;
        }
        showToast('No deadlines detected in announcement.');
        return;
      }

      if (statusBox) {
        statusBox.innerHTML = `
          <div class="extract-status-pill success">
            <span>${getSvgIcon('check', 'mr-1')} Found ${result.tasks.length} deadline(s) via ${escapeHtml(result.tier)}!</span>
          </div>
        `;
      }

      if (previewList) {
        previewList.innerHTML = result.tasks.map((task, idx) => {
          const d = new Date(task.dueDate);
          const dateStr = !isNaN(d.getTime()) ? d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : 'Date pending';
          const timeStr = task.hasSpecificTime && !isNaN(d.getTime()) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Class time';
          return `
            <div class="extract-result-item" id="extract-item-${idx}">
              <div class="extract-result-header">
                <div>
                  <h4 class="extract-result-title">${escapeHtml(task.title)}</h4>
                  <div class="extract-result-meta">
                    <span>${getSvgIcon('book', 'mr-1')} ${escapeHtml(task.courseName)}</span>
                    <span>${getSvgIcon('calendar', 'mr-1')} ${dateStr} at ${timeStr}</span>
                    ${task.room ? `<span class="badge-room-tag">${getSvgIcon('pin', 'mr-1')} ${escapeHtml(task.room)}</span>` : ''}
                    ${task.weightDisplay ? `<span class="badge-weight-tag">${getSvgIcon('scale', 'mr-1')} ${escapeHtml(task.weightDisplay)}</span>` : ''}
                    <span class="badge-jev-tag">${escapeHtml((task.type || 'assignment').toUpperCase())}</span>
                  </div>
                </div>
                <button type="button" class="btn-primary-action btn-add-extracted-item" data-idx="${idx}" style="font-size: 11px; padding: 6px 12px; height: 34px; white-space: nowrap;">
                  <span>${getSvgIcon('plus', 'mr-1')} Add to Deadlines</span>
                </button>
              </div>
              ${task.description ? `<p style="font-size: 11px; color: var(--text-muted); margin-top: 6px; line-height: 1.4;">${escapeHtml(task.description.slice(0, 150))}${task.description.length > 150 ? '...' : ''}</p>` : ''}
            </div>
          `;
        }).join('');

        // Bind Add buttons on preview items
        previewList.querySelectorAll('.btn-add-extracted-item').forEach(addBtn => {
          addBtn.addEventListener('click', async () => {
            const idx = parseInt(addBtn.getAttribute('data-idx'), 10);
            const taskToAdd = result.tasks[idx];
            if (!taskToAdd) return;

            state.tasks.push(taskToAdd);
            await syncToCloudAndLocal();

            addBtn.disabled = true;
            addBtn.innerHTML = `${getSvgIcon('check', 'mr-1')} <span>Added</span>`;
            addBtn.style.background = 'var(--text-main)';
            addBtn.style.color = '#ffffff';

            showToast(`Added "${taskToAdd.title}" to deadlines!`);
          });
        });
      }
    } catch (err) {
      console.error('Extract announcement error:', err);
      if (statusBox) {
        statusBox.innerHTML = `
          <div class="extract-status-pill error" style="display: inline-flex; align-items: center; gap: 4px;">
            ${getSvgIcon('urgent')}
            <span>Extraction error: ${escapeHtml(err.message || 'Unknown error')}</span>
          </div>
        `;
      }
      showToast('Extraction error: ' + (err.message || 'Failed'));
    } finally {
      if (btnRunExtract) btnRunExtract.disabled = false;
      if (btnIcon) btnIcon.innerHTML = getSvgIcon('bolt');
      if (btnText) btnText.textContent = 'Extract Deadlines';
    }
  });

  // Edit Form Submit
  const editForm = document.getElementById('form-edit-task');
  editForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const taskId = document.getElementById('edit-task-id').value;
    const task = state.tasks.find(t => t.id === taskId);
    if (!task) return;

    const title = document.getElementById('edit-title').value.trim();
    const course = document.getElementById('edit-course').value.trim();
    const dateVal = document.getElementById('edit-date').value;
    const timeVal = document.getElementById('edit-time').value;
    const roomVal = document.getElementById('edit-room')?.value.trim() || '';
    const type = document.getElementById('edit-type').value;
    const priority = document.getElementById('edit-priority').value;
    const status = document.getElementById('edit-status').value;
    const weightVal = parseFloat(document.getElementById('edit-weight').value);
    const descVal = document.getElementById('edit-desc')?.value.trim() || '';
    const notesVal = document.getElementById('edit-notes')?.value.trim() || '';

    task.title = title;
    task.courseName = course;
    for (const item of PERMANENT_COURSE_LEGEND) {
      if (item.pattern.test(course) || item.name.toLowerCase() === course.toLowerCase()) {
        task.courseCode = item.code;
        break;
      }
    }
    if (timeVal) {
      task.dueDate = new Date(`${dateVal}T${timeVal}:00`).toISOString();
      task.hasSpecificTime = true;
    } else {
      const defaultDate = new Date(`${dateVal}T23:59:00`);
      let appliedSched = false;
      const courseContext = `${course} ${task.courseCode || ''} ${title}`;
      const sched = BB.findCourseSchedule(courseContext);
      if (sched) {
        defaultDate.setHours(sched.startHour, sched.startMinute, 0, 0);
        appliedSched = true;
      }
      task.dueDate = defaultDate.toISOString();
      task.hasSpecificTime = appliedSched;
    }
    const isHwOrProj = type === 'assignment' || type === 'hw' || type === 'project';
    task.room = isHwOrProj ? undefined : (roomVal || undefined);
    task.type = type;
    task.priority = priority;
    task.status = status;
    if (!isNaN(weightVal) && weightVal > 0) {
      task.weight = weightVal;
      task.weightDisplay = `${weightVal}% of Grade`;
      const wRes = resolveTaskWeight(course, title, type, `${descVal} ${notesVal}`);
      task.syllabusNote = wRes.syllabusNote || `${weightVal}% of Grade`;
    } else {
      task.weight = undefined;
      task.weightDisplay = undefined;
      task.syllabusNote = undefined;
    }
    task.description = descVal;
    task.sourceSnippet = descVal;
    task.notes = notesVal;
    task.userEdited = true;
    task.updatedAt = new Date().toISOString();

    // Re-sort state.tasks by dueDate ascending (earliest first)
    state.tasks.sort(compareTasksByTime);

    closeEditModal();
    enqueueOfflineMutation({ type: 'edit', task });

    showToast('Deadline updated and synced with Firebase');
    syncToCloudAndLocal();

    // If #day-sheet-drawer is open, refresh #day-sheet-items with the re-sorted tasks for that day
    const dayDrawer = document.getElementById('day-sheet-drawer');
    if (dayDrawer && !dayDrawer.classList.contains('hidden') && dayDrawer.style.display !== 'none') {
      const dayTasks = state.tasks.filter(t => t.dueDate && localDateKey(t.dueDate) === dateVal);
      dayTasks.sort(compareTasksByTime);
      openDaySheet(dateVal, dayTasks);
    }
  });

  // Delete Task Button with 5-Second Undo
  document.getElementById('btn-delete-task')?.addEventListener('click', async () => {
    const taskId = document.getElementById('edit-task-id').value;
    const taskIndex = state.tasks.findIndex(t => t.id === taskId);
    if (taskIndex === -1) return;

    const deletedTask = state.tasks[taskIndex];
    state.tasks.splice(taskIndex, 1);
    closeEditModal();

    // Also close day sheet if open
    const dayBackdrop = document.getElementById('day-sheet-backdrop');
    const dayDrawer = document.getElementById('day-sheet-drawer');
    if (dayBackdrop) {
      dayBackdrop.classList.add('hidden');
      dayBackdrop.style.display = 'none';
    }
    if (dayDrawer) {
      dayDrawer.classList.add('hidden');
      dayDrawer.style.display = 'none';
    }

    recordLocalTombstone(taskId);
    enqueueOfflineMutation({ type: 'delete', taskId });

    showToast(
      `Deleted "${deletedTask.title.slice(0, 22)}..."`,
      'Undo',
      async () => {
        removeLocalTombstone(deletedTask.id);
        state.tasks.splice(taskIndex, 0, deletedTask);
        enqueueOfflineMutation({ type: 'add', task: deletedTask });
        syncToCloudAndLocal();
        showToast('Deadline restored');
      }
    );

    syncToCloudAndLocal();
  });

  // Add Form Submit
  const addForm = document.getElementById('form-add-task');
  addForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = document.getElementById('add-title').value.trim();
    const course = document.getElementById('add-course').value.trim();
    const dateVal = document.getElementById('add-date').value;
    const timeVal = document.getElementById('add-time').value;
    const manualRoom = document.getElementById('add-room')?.value.trim() || '';
    const type = document.getElementById('add-type').value;
    const priority = document.getElementById('add-priority').value;
    const weightVal = parseFloat(document.getElementById('add-weight').value);
    const notes = document.getElementById('add-notes').value.trim();

    let dueDateIso = '';
    let hasSpecificTime = false;
    if (timeVal) {
      dueDateIso = new Date(`${dateVal}T${timeVal}:00`).toISOString();
      hasSpecificTime = true;
    } else {
      const defaultDate = new Date(`${dateVal}T23:59:00`);
      let appliedSched = false;
      const courseContext = `${course} ${title} ${notes}`;
      const sched = BB.findCourseSchedule(courseContext);
      if (sched) {
        defaultDate.setHours(sched.startHour, sched.startMinute, 0, 0);
        appliedSched = true;
      }
      dueDateIso = defaultDate.toISOString();
      hasSpecificTime = appliedSched;
    }

    const isHwOrProj = type === 'assignment' || type === 'hw' || type === 'project';
    const room = isHwOrProj ? undefined : (manualRoom || resolveTaskRoom({
      title,
      courseName: course,
      courseCode: 'UOS',
      type,
      sourceSnippet: notes,
      description: notes
    }) || undefined);

    const resolvedWeight = resolveTaskWeight(course, title, type, notes);
    const finalWeight = !isNaN(weightVal) && weightVal > 0 ? weightVal : resolvedWeight.weight;
    const finalWeightDisplay = !isNaN(weightVal) && weightVal > 0 ? `${weightVal}% of Grade` : resolvedWeight.weightDisplay;
    const finalSyllabusNote = resolvedWeight.syllabusNote;

    const newTask = {
      id: `task_mobile_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      title,
      courseName: course,
      courseCode: 'UOS',
      dueDate: dueDateIso,
      hasSpecificTime,
      room,
      type,
      priority,
      status: 'pending',
      weight: finalWeight,
      weightDisplay: finalWeightDisplay,
      syllabusNote: finalSyllabusNote,
      description: notes,
      sourceSnippet: notes,
      extractedBy: 'manual',
      userEdited: true,
      confidence: 1.0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    state.selectedDate = localDateKey(dueDateIso);
    state.tasks.push(newTask);
    state.tasks = deduplicateTaskList(state.tasks);
    state.tasks.sort(compareTasksByTime);
    addForm.reset();
    closeAddModal();
    showToast('New deadline added and synced');
    syncToCloudAndLocal();
  });

  initOnboardingModal();
}

function openEditTaskModal(task) {
  const modal = document.getElementById('modal-edit-task');
  if (!modal) return;

  const { courseName, courseCode } = resolveCourseInfo(task);
  document.getElementById('edit-task-id').value = task.id;
  document.getElementById('edit-title').value = task.title || '';
  document.getElementById('edit-course').value = courseName || courseCode || '';

  const due = new Date(task.dueDate);
  if (!isNaN(due.getTime())) {
    const pad = n => String(n).padStart(2, '0');
    const yyyy = due.getFullYear();
    const mm = pad(due.getMonth() + 1);
    const dd = pad(due.getDate());
    document.getElementById('edit-date').value = `${yyyy}-${mm}-${dd}`;

    if (task.hasSpecificTime) {
      const hh = pad(due.getHours());
      const min = pad(due.getMinutes());
      document.getElementById('edit-time').value = `${hh}:${min}`;
    } else {
      document.getElementById('edit-time').value = '';
    }
  }

  const selectedType = task.type || 'assignment';
  document.getElementById('edit-type').value = selectedType;
  document.getElementById('edit-priority').value = task.priority || 'medium';
  document.getElementById('edit-status').value = task.status || 'pending';
  const isHwOrProj = selectedType === 'assignment' || selectedType === 'hw' || selectedType === 'project';
  const editRoom = document.getElementById('edit-room');
  const editRoomGroup = editRoom ? editRoom.closest('.form-group') : null;
  if (editRoomGroup) {
    editRoomGroup.style.display = isHwOrProj ? 'none' : '';
  }
  if (editRoom) editRoom.value = isHwOrProj ? '' : (task.room || '');
  document.getElementById('edit-weight').value = task.weight || '';

  const editWeightHint = document.getElementById('edit-weight-hint');
  if (editWeightHint) {
    if (task.syllabusNote) {
      editWeightHint.innerHTML = `${getSvgIcon('scale', 'mr-1')} <strong>${escapeHtml(task.weightDisplay || '')}</strong>: ${escapeHtml(task.syllabusNote)}`;
      editWeightHint.style.color = 'var(--primary)';
    } else {
      editWeightHint.textContent = '';
    }
  }
  
  const editDesc = document.getElementById('edit-desc');
  if (editDesc) editDesc.value = task.description || task.sourceSnippet || '';
  const editNotes = document.getElementById('edit-notes');
  if (editNotes) editNotes.value = task.notes || '';

  modal.style.display = 'flex';
  modal.classList.remove('hidden');
}

function closeEditModal() {
  const modal = document.getElementById('modal-edit-task');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.add('hidden');
  }
}
const closeEditTaskModal = closeEditModal;
window.closeEditModal = closeEditModal;
window.closeEditTaskModal = closeEditModal;

function openAddTaskModal(prefilledDate = null) {
  const modal = document.getElementById('modal-add-task');
  if (!modal) return;

  const dateInput = document.getElementById('add-date');
  if (prefilledDate && dateInput) {
    dateInput.value = prefilledDate;
  } else if (dateInput && !dateInput.value) {
    const now = new Date();
    const pad = n => String(n).padStart(2, '0');
    dateInput.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  const addType = document.getElementById('add-type');
  const addTypeValue = addType ? addType.value : 'assignment';
  const isHwOrProj = addTypeValue === 'assignment' || addTypeValue === 'hw' || addTypeValue === 'project';
  const addRoom = document.getElementById('add-room');
  const addRoomGroup = addRoom ? addRoom.closest('.form-group') : null;
  if (addRoomGroup) {
    addRoomGroup.style.display = isHwOrProj ? 'none' : '';
  }
  if (addRoom) addRoom.value = '';

  const addWeight = document.getElementById('add-weight');
  if (addWeight) addWeight.value = '';
  const addWeightHint = document.getElementById('add-weight-hint');
  if (addWeightHint) addWeightHint.textContent = '';

  modal.style.display = 'flex';
  modal.classList.remove('hidden');
}

function closeAddModal() {
  const modal = document.getElementById('modal-add-task');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.add('hidden');
  }
}

let activeRoomPickerTaskId = null;

function openRoomPicker(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;
  activeRoomPickerTaskId = taskId;

  const modal = document.getElementById('modal-room-picker');
  const presetsContainer = document.getElementById('room-presets-container');
  const customInput = document.getElementById('input-custom-room');
  if (!modal || !presetsContainer) return;

  const currentRoom = (task.room || '').trim();
  if (customInput) customInput.value = currentRoom;

  // Render presets from STUDENT_CLASS_SCHEDULE
  const uniquePresets = [];
  const seenRooms = new Set();
  for (const s of STUDENT_CLASS_SCHEDULE) {
    if (!s.room || seenRooms.has(s.room.trim().toLowerCase())) continue;
    seenRooms.add(s.room.trim().toLowerCase());
    uniquePresets.push(s);
  }

  presetsContainer.innerHTML = uniquePresets.map(s => {
    const isCurrent = currentRoom.toLowerCase() === s.room.toLowerCase();
    return `
      <button type="button" class="room-preset-btn ${isCurrent ? 'is-active' : ''}" data-room="${escapeHtml(s.room)}">
        <div class="room-preset-left">
          <span class="room-preset-code">${getSvgIcon('pin', 'mr-1')} ${escapeHtml(s.room)}</span>
          <span class="room-preset-course">${escapeHtml(s.courseName)}</span>
        </div>
        ${isCurrent ? '<span style="color:#4338ca; font-size:12px; font-weight:700;">✓ Current</span>' : '<span style="color:var(--text-muted); font-size:12px;">Select</span>'}
      </button>
    `;
  }).join('');

  // Bind clicks on presets
  presetsContainer.querySelectorAll('.room-preset-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const selectedRoom = btn.getAttribute('data-room');
      await applyRoomChange(taskId, selectedRoom);
      closeRoomPicker();
    });
  });

  modal.style.display = 'flex';
  modal.classList.remove('hidden');
}

function closeRoomPicker() {
  const modal = document.getElementById('modal-room-picker');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.add('hidden');
  }
  activeRoomPickerTaskId = null;
}

async function applyRoomChange(taskId, newRoom) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;

  const cleanedRoom = (newRoom || '').trim();
  task.room = cleanedRoom || undefined;
  task.updatedAt = new Date().toISOString();

  await syncToCloudAndLocal();
  showToast(`Room updated to "${cleanedRoom || 'None'}" and synced`);
}

function openReadingSheet(task) {
  const modal = document.getElementById('modal-reading-sheet');
  const badgeGroup = document.getElementById('reading-modal-badges');
  const content = document.getElementById('reading-modal-content');
  if (!modal || !badgeGroup || !content) return;

  const { courseName, courseCode } = resolveCourseInfo(task);
  const courseTheme = getCourseColorTheme(courseName, courseCode, task.title);
  const isCompleted = task.status === 'completed';
  const countdown = formatCountdown(task.dueDate, task.hasSpecificTime, task.status);
  const typeIcon = getTaskTypeIcon(task.type);
  const typeLabel = (task.type || 'assignment').toUpperCase();
  const gcalUrl = createGoogleCalendarUrl(task);

  const fullAnnouncement = (task.description || task.sourceSnippet || '').trim();
  const hasAnnouncement = fullAnnouncement && !fullAnnouncement.startsWith('Blackboard Ultra Stream item');

  const isHwOrProj = task.type === 'assignment' || task.type === 'hw' || task.type === 'project';

  badgeGroup.innerHTML = `
    <div class="course-badge-main" style="background: ${courseTheme.bgLight}; border: 1px solid ${courseTheme.border}; color: ${courseTheme.textDark};">
      <span class="course-color-dot" style="background: ${courseTheme.hex};"></span>
      <span class="course-name-text">${escapeHtml(courseName)}</span>
      ${courseCode && courseCode.toLowerCase() !== 'uos' ? `<span class="course-code-tag" style="color: ${courseTheme.textDark};">${escapeHtml(courseCode)}</span>` : ''}
    </div>
    <div style="display: flex; align-items: center; gap: 6px;">
      <span class="type-pill type-${escapeHtml(task.type || 'assignment')}">
        <span>${typeIcon}</span>
        <span>${typeLabel}</span>
      </span>
    </div>
  `;

  content.innerHTML = `
    <h2 class="reading-pane-title">${escapeHtml(task.title)}</h2>

    <div class="reading-meta-section">
      <span class="urgency-badge ${countdown.urgency}">
        ${countdown.urgency === 'completed'
          ? `${getSvgIcon('check', 'mr-1')} ${escapeHtml(countdown.label)}`
          : (countdown.urgency === 'overdue' ? `${getSvgIcon('urgent', 'mr-1')} ${escapeHtml(countdown.label)}` : `${getSvgIcon('clock', 'mr-1')} ${escapeHtml(countdown.label)}`)}
      </span>
      ${!isHwOrProj ? `
      <button type="button" class="room-pill-btn modal-reading-room-btn" data-task-id="${escapeHtml(task.id)}">
        <span>${getSvgIcon('pin', 'mr-1')} ${escapeHtml(task.room || 'No room set')}</span>
        <span class="room-edit-hint">${getSvgIcon('pencil')}</span>
      </button>
      ` : ''}
      ${task.weightDisplay || task.weight ? `<span class="task-weight-pill weight-major">${getSvgIcon('scale', 'mr-1')} ${escapeHtml(task.weightDisplay || `${task.weight}%`)}</span>` : ''}
      ${task.scoreDisplay || task.score !== undefined ? `
        <span class="task-grade-pill" title="Grade / Score released on Blackboard">
          ${getSvgIcon('star', 'mr-1')} <span>${escapeHtml(task.scoreDisplay || `${task.score} pts`)}</span>
        </span>
      ` : (task.submissionStatus === 'graded' ? `
        <span class="task-grade-pill">
          ${getSvgIcon('star', 'mr-1')} <span>Graded</span>
        </span>
      ` : '')}
      ${task.submissionStatus === 'submitted' ? `
        <span class="task-submitted-pill" title="${task.submissionReceipt ? `Receipt: ${escapeHtml(task.submissionReceipt)}` : 'Submitted to Blackboard'}">
          ${getSvgIcon('check', 'mr-1')} <span>Submitted</span>
        </span>
      ` : ''}
    </div>

    <div class="reading-announcement-box">
      <div class="reading-box-header">
        <span class="reading-box-title">
          <span>${getSvgIcon('message', 'mr-1')}</span>
          <span>Doctor Announcement</span>
        </span>
        ${hasAnnouncement ? `
          <button type="button" class="btn-copy-announcement" id="btn-copy-drawer-text">
            <span>${getSvgIcon('copy', 'mr-1')} Copy</span>
          </button>
        ` : ''}
      </div>
      <div class="reading-box-content" style="max-height: 50vh; overflow-y: auto;">
        ${hasAnnouncement ? escapeHtml(fullAnnouncement) : '<span style="color: var(--text-muted);">No detailed announcement text available.</span>'}
      </div>
    </div>

    <!-- Student Personal Notes -->
    ${task.notes && task.notes.trim() ? `
      <div class="reading-notes-box" style="margin-top: 12px; padding: 12px 14px; background: var(--surface-hover); border-left: 3px solid var(--text-main); border-radius: var(--radius-sm);">
        <div style="font-size: 12px; font-weight: 700; color: var(--text-main); display: flex; align-items: center; gap: 6px; margin-bottom: 6px;">
          ${getSvgIcon('pencil')}
          <span>Student Personal Notes</span>
        </div>
        <div style="font-size: 13px; color: var(--text-main); white-space: pre-wrap; line-height: 1.5;">${escapeHtml(task.notes)}</div>
      </div>
    ` : ''}

    <div class="reading-actions-bar">
      <button type="button" class="btn-primary-action modal-reading-toggle-btn" style="flex: 1; min-height: 44px;">
        ${isCompleted ? `${getSvgIcon('refresh', 'mr-1')} Mark Pending` : `${getSvgIcon('check', 'mr-1')} Mark Done`}
      </button>
      <button type="button" class="btn-outline-action modal-reading-share-btn" style="min-height: 44px; padding: 0 12px;">
        <span>${getSvgIcon('share', 'mr-1')} Share</span>
      </button>
      <a class="btn-outline-action" href="${gcalUrl}" target="_blank" rel="noopener noreferrer" style="min-height: 44px; display: inline-flex; align-items: center; text-decoration: none; padding: 0 12px;">
        <span>${getSvgIcon('calendar', 'mr-1')} Calendar</span>
      </a>
      <button type="button" class="btn-outline-action modal-reading-edit-btn" style="min-height: 44px; padding: 0 12px;">
        <span>${getSvgIcon('pencil', 'mr-1')} Edit</span>
      </button>
    </div>
  `;

  modal.style.display = 'flex';
  modal.classList.remove('hidden');

  // Bind inside drawer
  const copyDrawer = document.getElementById('btn-copy-drawer-text');
  if (copyDrawer && hasAnnouncement) {
    copyDrawer.onclick = async () => {
      try {
        await navigator.clipboard.writeText(fullAnnouncement);
        showToast('Announcement text copied!');
      } catch (e) {
        showToast('Could not copy text.');
      }
    };
  }

  content.querySelector('.modal-reading-share-btn')?.addEventListener('click', () => {
    shareTaskDetails(task);
  });

  content.querySelector('.modal-reading-room-btn')?.addEventListener('click', () => {
    closeReadingSheet();
    openRoomPicker(task.id);
  });

  content.querySelector('.modal-reading-edit-btn')?.addEventListener('click', () => {
    closeReadingSheet();
    openEditTaskModal(task);
  });

  content.querySelector('.modal-reading-toggle-btn')?.addEventListener('click', async () => {
    const prevStatus = task.status;
    const newStatus = prevStatus === 'completed' ? 'pending' : 'completed';
    task.status = newStatus;
    task.updatedAt = new Date().toISOString();
    closeReadingSheet();

    showToast(
      newStatus === 'completed' ? 'Marked as completed' : 'Reverted to pending',
      'Undo',
      async () => {
        task.status = prevStatus;
        task.updatedAt = new Date().toISOString();
        enqueueOfflineMutation({ type: 'status', taskId: task.id, status: prevStatus });
        syncToCloudAndLocal();
        showToast('Status reverted');
      }
    );

    enqueueOfflineMutation({ type: 'status', taskId: task.id, status: newStatus });
    syncToCloudAndLocal();
  });
}

function closeReadingSheet() {
  const modal = document.getElementById('modal-reading-sheet');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.add('hidden');
  }
}

// ==========================================================================
// Onboarding Tutorial & Setup Guide
// ==========================================================================
let _onboardingStep = 1;

function setOnboardingStep(step) {
  const boundedStep = Math.max(1, Math.min(4, step));
  _onboardingStep = boundedStep;

  // 1. Toggle step panes
  for (let i = 1; i <= 4; i++) {
    const pane = document.getElementById(`onboarding-step-${i}`);
    if (pane) {
      if (i === boundedStep) {
        pane.style.display = 'block';
        pane.classList.add('active');
      } else {
        pane.style.display = 'none';
        pane.classList.remove('active');
      }
    }
  }

  // 2. Update stepper indicators
  document.querySelectorAll('.onboarding-stepper .step-indicator').forEach(ind => {
    const s = parseInt(ind.getAttribute('data-step') || '1', 10);
    ind.classList.remove('active', 'completed');
    if (s === boundedStep) {
      ind.classList.add('active');
    } else if (s < boundedStep) {
      ind.classList.add('completed');
    }
  });

  // 3. Update footer navigation buttons
  const btnPrev = document.getElementById('btn-onboarding-prev');
  const btnNext = document.getElementById('btn-onboarding-next');
  const btnFinish = document.getElementById('btn-onboarding-finish');

  if (btnPrev) btnPrev.style.display = boundedStep > 1 ? 'inline-block' : 'none';
  if (btnNext) btnNext.style.display = boundedStep < 4 ? 'inline-block' : 'none';
  if (btnFinish) btnFinish.style.display = boundedStep === 4 ? 'inline-block' : 'none';

  // 4. Update Step 3 pairing status display
  if (boundedStep === 3) {
    const currentKey = getSyncKey();
    const statusDiv = document.getElementById('onboarding-pairing-status');
    if (statusDiv) {
      if (currentKey) {
        statusDiv.innerHTML = `<span style="color: var(--text-main); display: inline-flex; align-items: center; gap: 6px;">
          <span style="display: inline-block; width: 8px; height: 8px; border-radius: 0; background: var(--text-main);"></span>
          <span>✓ <strong>Device Paired:</strong> Connected to sync code <strong>${escapeHtml(currentKey)}</strong>. Your private cloud deadlines and calendar feed are live!</span>
        </span>`;
      } else {
        statusDiv.innerHTML = `<span style="color: var(--text-muted); display: inline-flex; align-items: center; gap: 6px;">
          <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #94a3b8;"></span>
          <span>Status: <strong>Not Paired</strong>. Open this page via the pairing link from your Chrome extension to connect.</span>
        </span>`;
      }
    }
  }
}

function openOnboardingModal(step = 1) {
  const modal = document.getElementById('modal-onboarding');
  if (!modal) return;
  setOnboardingStep(step);
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
}

function closeOnboardingModal() {
  const modal = document.getElementById('modal-onboarding');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.style.display = 'none';
}

function initOnboardingModal() {
  const modal = document.getElementById('modal-onboarding');
  if (!modal) return;

  // Open triggers
  document.getElementById('btn-open-onboarding')?.addEventListener('click', () => {
    openOnboardingModal(1);
  });
  document.getElementById('btn-settings-onboarding')?.addEventListener('click', () => {
    openOnboardingModal(1);
  });

  // Close triggers
  document.getElementById('btn-close-onboarding')?.addEventListener('click', closeOnboardingModal);
  document.getElementById('btn-onboarding-finish')?.addEventListener('click', () => {
    closeOnboardingModal();
    showToast('Setup complete! Welcome to Blackboarder.');
  });
  modal.addEventListener('click', (e) => {
    if (e.target.id === 'modal-onboarding') closeOnboardingModal();
  });

  // Step navigation buttons
  document.getElementById('btn-onboarding-prev')?.addEventListener('click', () => {
    setOnboardingStep(_onboardingStep - 1);
  });
  document.getElementById('btn-onboarding-next')?.addEventListener('click', () => {
    setOnboardingStep(_onboardingStep + 1);
  });

  // Direct stepper indicators click
  modal.querySelectorAll('.step-indicator').forEach(ind => {
    ind.addEventListener('click', () => {
      const s = parseInt(ind.getAttribute('data-step') || '1', 10);
      setOnboardingStep(s);
    });
  });
}

async function syncToCloudAndLocal(waitForNetwork = false) {
  state.tasks = (state.tasks || []).filter(isValidTask);
  state.tasks.sort(compareTasksByTime);
  state.lastSync = new Date().toISOString();
  localStorage.setItem('bbs_mobile_tasks', JSON.stringify(state.tasks));
  localStorage.setItem('bbs_mobile_last_sync', state.lastSync);
  if (state.quickLinks && state.quickLinks.length > 0) {
    localStorage.setItem('bbs_quick_links', JSON.stringify(state.quickLinks));
  }

  // Defer heavy DOM re-renders by 1 frame so toasts and tactile click feedback paint immediately
  requestAnimationFrame(() => {
    updateAllViews();
    updateSyncBanner();
    syncTasksToServiceWorker();
    checkUpcomingDeadlines(false);
  });

  // Local state is already saved and rendered above. Network pushes run in the background,
  // serialized, so toasts and UI feedback never wait on Firebase round trips.
  const run = () => pushStateToCloud();
  cloudSyncChain = cloudSyncChain.then(run, run).catch(() => false);
  return waitForNetwork ? cloudSyncChain : true;
}

let cloudSyncChain = Promise.resolve(true);

async function pushStateToCloud() {
  // Preserve latest courses and coursesUpdatedAt from cloud snapshot
  let coursesToSync = state.userCourses || undefined;
  let coursesUpdatedAtToSync = state.coursesUpdatedAt || localStorage.getItem('bbs_mobile_courses_updated_at') || undefined;

  let snap = null;
  try {
    const fbUrl = getFirebaseDataUrl();
    if (fbUrl) {
      const snapRes = await fetch(fbUrl, { cache: 'no-store' });
      if (snapRes.ok) {
        snap = await snapRes.json();
        if (snap && Array.isArray(snap.courses)) {
          const snapTime = snap.coursesUpdatedAt ? new Date(snap.coursesUpdatedAt).getTime() : 0;
          const localTime = coursesUpdatedAtToSync ? new Date(coursesUpdatedAtToSync).getTime() : 0;

          if (snapTime >= localTime) {
            coursesToSync = snap.courses;
            coursesUpdatedAtToSync = snap.coursesUpdatedAt || undefined;

            // Update mobile local state if cloud snapshot had newer courses
            if (snapTime > localTime) {
              const prevCoursesJson = JSON.stringify(state.userCourses || []);
              const newCoursesJson = JSON.stringify(snap.courses);
              if (prevCoursesJson !== newCoursesJson) {
                state.userCourses = snap.courses;
                state.coursesUpdatedAt = snap.coursesUpdatedAt || null;
                localStorage.setItem('bbs_mobile_courses', newCoursesJson);
                const activeKey = getSyncKey();
                if (activeKey) {
                  localStorage.setItem(`bbs_mobile_courses_${activeKey}`, newCoursesJson);
                }
                if (snap.coursesUpdatedAt) {
                  localStorage.setItem('bbs_mobile_courses_updated_at', snap.coursesUpdatedAt);
                }
                recompileDynamicCourseData(state.userCourses);
                recalculateAllTaskWeightsAndRooms();
                initLegend();
                initScheduleAndSyllabus();
                renderGradeTracker();
                updateCourseDatalist();
              }
            }
          }
        }
      }
    }
  } catch (snapErr) {
    // If snapshot check fails, proceed with local courses
  }

  // The PUT replaces the whole cloud document, so carry over what this device has not seen yet:
  // other devices' tombstones, their newly added tasks, and quick links if we have none.
  const tombstones = getLocalTombstones();
  let tasksToPush = state.tasks;
  let linksToPush = state.quickLinks;
  if (snap && typeof snap === 'object') {
    if (snap.tombstones && typeof snap.tombstones === 'object') {
      for (const [tombId, tombTime] of Object.entries(BB.decodeCloudKeys(snap.tombstones))) {
        if (!tombstones[tombId] || new Date(tombTime).getTime() > new Date(tombstones[tombId]).getTime()) {
          tombstones[tombId] = tombTime;
        }
      }
    }
    const cloudTasks = sanitizeCloudTasks(snap.tasks);
    const cloudById = new Map(cloudTasks.map(ct => [ct.id, ct]));
    const stamp = t => new Date(t.updatedAt || t.createdAt || 0).getTime() || 0;
    const localIds = new Set((state.tasks || []).map(t => t.id));
    // A task edited on another device after this phone last fetched keeps that newer copy
    tasksToPush = (state.tasks || []).map(t => {
      const ct = cloudById.get(t.id);
      return ct && stamp(ct) > stamp(t) ? ct : t;
    });
    const cloudOnly = cloudTasks.filter(ct => {
      if (localIds.has(ct.id)) return false;
      const tomb = tombstones[ct.id];
      return !(tomb && new Date(tomb).getTime() >= stamp(ct));
    });
    if (cloudOnly.length > 0) tasksToPush = [...tasksToPush, ...cloudOnly];
    if ((!linksToPush || linksToPush.length === 0) && Array.isArray(snap.quickLinks)) {
      linksToPush = sanitizeCloudQuickLinks(snap.quickLinks);
    }
  }
  const payload = {
    tasks: tasksToPush,
    quickLinks: linksToPush,
    courses: coursesToSync,
    coursesUpdatedAt: coursesUpdatedAtToSync,
    lastSync: state.lastSync,
    device: 'Mobile Web App',
    count: tasksToPush.length,
    syncKey: getSyncKey() || undefined,
    // Task ids can hold characters Firebase refuses as keys, so the keys are encoded for Firebase
    tombstones: Object.keys(tombstones).length > 0 ? BB.encodeCloudKeys(tombstones) : undefined
  };

  let cloudOk = false;
  try {
    const fbUrl = getFirebaseDataUrl();
    if (fbUrl) {
      const fbRes = await fetch(fbUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      cloudOk = fbRes.ok;
    }
  } catch (err) {
    console.warn('Firebase sync PUT error:', err);
  }

  // The edge API writes the same Firebase document, so it is only a fallback: a second, later
  // copy of this payload could overwrite a newer save from the extension.
  if (!cloudOk) {
    try {
      const activeKey = getSyncKey();
      const edgeSyncUrl = activeKey ? `/api/sync?key=${encodeURIComponent(activeKey)}` : '/api/sync';
      const edgeRes = await fetch(edgeSyncUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(activeKey ? { 'x-sync-key': activeKey } : {}) },
        body: JSON.stringify(payload)
      });
      cloudOk = edgeRes.ok;
    } catch (err) {}
  }

  try {
    const syncChannel = new BroadcastChannel('bbs_sync_channel');
    syncChannel.postMessage({ type: 'TASKS_UPDATED', timestamp: Date.now() });
    syncChannel.close();
  } catch (err) {}

  if (cloudOk) clearOfflineMutations();
  return cloudOk;
}

